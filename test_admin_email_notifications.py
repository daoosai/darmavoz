import pytest
from sqlalchemy import select

from app.models.models import DeliveryOption, Driver, MediaFile, ModerationStatus, Role, User, Vehicle
from app.security.auth import get_password_hash
from app.security.jwt import create_access_token


def auth_headers(username: str) -> dict[str, str]:
    token = create_access_token(data={"sub": username})
    return {"Authorization": f"Bearer {token}"}


async def ensure_role(session, name: str) -> Role:
    role = await session.scalar(select(Role).where(Role.name == name))
    if role is None:
        role = Role(name=name, description=name)
        session.add(role)
        await session.flush()
    return role


async def create_user(session, *, username: str, role: Role, email: str | None = None) -> User:
    user = User(
        username=username,
        email=email,
        hashed_password=get_password_hash("secret123"),
        role_id=role.id,
        is_active=True,
    )
    session.add(user)
    await session.flush()
    return user


@pytest.mark.asyncio
async def test_admin_can_update_own_email(client, session_factory):
    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        admin_user = await create_user(session, username="email_admin", role=admin_role)
        await session.commit()
        admin_username = admin_user.username

    response = await client.patch(
        "/api/v1/admin/me",
        headers=auth_headers(admin_username),
        json={"email": "Admin@Example.com"},
    )

    assert response.status_code == 200
    assert response.json()["email"] == "admin@example.com"
    assert response.json()["username"] == admin_username

    async with session_factory() as session:
        saved_user = await session.scalar(select(User).where(User.username == admin_username))

    assert saved_user is not None
    assert saved_user.email == "admin@example.com"


@pytest.mark.asyncio
async def test_admin_email_validation_returns_422(client, session_factory):
    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        admin_user = await create_user(session, username="bad_email_admin", role=admin_role)
        await session.commit()

    response = await client.patch(
        "/api/v1/admin/me",
        headers=auth_headers(admin_user.username),
        json={"email": "not-an-email"},
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_driver_submit_adds_admin_email_background_task(client, session_factory, monkeypatch):
    sent_messages: list[dict[str, str]] = []

    def fake_send_admin_moderation_email(*, to_email: str, driver_label: str) -> None:
        sent_messages.append({"to_email": to_email, "driver_label": driver_label})

    monkeypatch.setattr(
        "app.api.driver_dispatch.send_admin_moderation_email",
        fake_send_admin_moderation_email,
    )

    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        driver_role = await ensure_role(session, "driver")
        await create_user(session, username="notify_admin", role=admin_role, email="notify@example.com")
        driver_user = await create_user(session, username="+79990022233", role=driver_role)
        delivery_option = DeliveryOption(
            capacity_m3=15.0,
            title="Самосвал 15 м3",
            description="",
            base_price=5000.0,
            is_active=True,
            sort_order=0,
        )
        session.add(delivery_option)
        await session.flush()
        vehicle = Vehicle(
            title="Ready for moderation",
            brand="КамАЗ",
            plate_number="А111АА72",
            body_volume_m3=15.0,
            delivery_option_id=delivery_option.id,
            is_active=True,
            moderation_status=ModerationStatus.incomplete.value,
        )
        session.add(vehicle)
        await session.flush()
        driver = Driver(
            name="Иван Иванов",
            phone="+79990022233",
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            status="offline",
            moderation_status=ModerationStatus.incomplete.value,
        )
        session.add(driver)
        session.add_all(
            [
                MediaFile(
                    entity_type="vehicle",
                    entity_id=vehicle.id,
                    bucket="demo",
                    object_key="vehicles/main.jpg",
                    public_url="https://example.com/main.jpg",
                    content_type="image/jpeg",
                    file_name="main.jpg",
                    file_size=100,
                    slot_key="vehicle_main",
                ),
                MediaFile(
                    entity_type="vehicle",
                    entity_id=vehicle.id,
                    bucket="demo",
                    object_key="vehicles/left.jpg",
                    public_url="https://example.com/left.jpg",
                    content_type="image/jpeg",
                    file_name="left.jpg",
                    file_size=100,
                    slot_key="vehicle_left",
                ),
                MediaFile(
                    entity_type="vehicle",
                    entity_id=vehicle.id,
                    bucket="demo",
                    object_key="vehicles/plate.jpg",
                    public_url="https://example.com/plate.jpg",
                    content_type="image/jpeg",
                    file_name="plate.jpg",
                    file_size=100,
                    slot_key="vehicle_plate",
                ),
            ]
        )
        await session.commit()

    response = await client.post(
        "/api/v1/driver/vehicle/submit",
        headers=auth_headers("+79990022233"),
    )

    assert response.status_code == 200
    assert response.json()["moderation_status"] == ModerationStatus.pending_moderation.value
    assert {"to_email": "notify@example.com", "driver_label": "Иван Иванов"} in sent_messages
