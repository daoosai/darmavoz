import pytest
from sqlalchemy import select

from app.models.models import DeliveryOption, Driver, MediaFile, Role, User, Vehicle
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


async def create_user(session, *, username: str, role: Role) -> User:
    user = User(
        username=username,
        hashed_password=get_password_hash("secret123"),
        role_id=role.id,
        is_active=True,
    )
    session.add(user)
    await session.flush()
    return user


@pytest.mark.asyncio
async def test_logist_driver_list_includes_vehicle_ranges_and_presigned_photo(
    client,
    session_factory,
    monkeypatch,
):
    async with session_factory() as session:
        logist_role = await ensure_role(session, "logist")
        driver_role = await ensure_role(session, "driver")
        logist_user = await create_user(session, username="+79990011000", role=logist_role)
        driver_user = await create_user(session, username="+79990011001", role=driver_role)

        delivery_option = DeliveryOption(
            capacity_m3=12.0,
            title="12 м3",
            description="",
            base_price=5000.0,
            is_active=True,
            sort_order=0,
        )
        session.add(delivery_option)
        await session.flush()

        vehicle = Vehicle(
            title="Самосвал КамАЗ",
            brand="КамАЗ",
            model="6520",
            plate_number="А123АА72",
            vehicle_type="самосвал",
            cubature_min=10.0,
            cubature_max=14.0,
            tonnage_min=8.0,
            tonnage_max=12.0,
            delivery_option_id=delivery_option.id,
            is_active=True,
            moderation_status="approved",
        )
        session.add(vehicle)
        await session.flush()

        driver = Driver(
            name="Водитель логиста",
            phone="+79990011001",
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            status="available",
            is_active=True,
            moderation_status="approved",
        )
        session.add(driver)
        await session.flush()

        session.add_all(
            [
                MediaFile(
                    entity_type="vehicle",
                    entity_id=vehicle.id,
                    bucket="media",
                    object_key="vehicles/main.jpg",
                    public_url="https://public.example/main.jpg",
                    content_type="image/jpeg",
                    file_name="main.jpg",
                    file_size=12345,
                    sort_order=0,
                    slot_key="vehicle_main",
                    is_primary=True,
                ),
                MediaFile(
                    entity_type="vehicle",
                    entity_id=vehicle.id,
                    bucket="media",
                    object_key="vehicles/left.jpg",
                    public_url="https://public.example/left.jpg",
                    content_type="image/jpeg",
                    file_name="left.jpg",
                    file_size=12345,
                    sort_order=1,
                    slot_key="vehicle_left",
                    is_primary=False,
                ),
            ]
        )
        await session.commit()

    class DummyStorage:
        def generate_presigned_get(self, object_key: str, expires_in: int | None = None) -> str:
            del expires_in
            return f"https://signed.example/{object_key}"

    monkeypatch.setattr("app.api.drivers.get_storage_service", lambda: DummyStorage())

    response = await client.get(
        f"/api/v1/drivers/?delivery_option_id={delivery_option.id}&status=available",
        headers=auth_headers(logist_user.username),
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1

    driver_payload = payload[0]
    assert driver_payload["name"] == "Водитель логиста"
    assert driver_payload["vehicle_type"] == "самосвал"
    assert driver_payload["vehicle_cubature_min"] == 10.0
    assert driver_payload["vehicle_cubature_max"] == 14.0
    assert driver_payload["vehicle_tonnage_min"] == 8.0
    assert driver_payload["vehicle_tonnage_max"] == 12.0
    assert driver_payload["vehicle_main_url"] == "https://signed.example/vehicles/main.jpg"
    assert driver_payload["vehicle_left_url"] == "https://signed.example/vehicles/left.jpg"
    assert driver_payload["vehicle"]["vehicle_type"] == "самосвал"
    assert driver_payload["vehicle"]["cubature_min"] == 10.0
    assert driver_payload["vehicle"]["tonnage_max"] == 12.0
