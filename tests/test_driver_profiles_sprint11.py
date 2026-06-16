import pytest
from sqlalchemy import select

from app.models.models import DeliveryOption, Driver, ModerationStatus, Role, User, Vehicle
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


async def create_delivery_option(session, *, capacity_m3: float, title: str) -> DeliveryOption:
    delivery_option = DeliveryOption(
        capacity_m3=capacity_m3,
        title=title,
        description="",
        base_price=5000.0,
        is_active=True,
        sort_order=0,
    )
    session.add(delivery_option)
    await session.flush()
    return delivery_option


@pytest.mark.asyncio
async def test_driver_can_self_register_with_pending_moderation(client, session_factory):
    response = await client.post(
        "/api/v1/auth/driver/register",
        json={
            "phone": "+79990010101",
            "password": "driver123",
            "name": "Новый водитель",
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["role"] == "driver"
    assert payload["driver"]["phone"] == "+79990010101"
    assert payload["driver"]["moderation_status"] == ModerationStatus.pending_moderation.value
    assert payload["driver"]["vehicle"] is None

    async with session_factory() as session:
        driver = await session.scalar(select(Driver).where(Driver.phone == "+79990010101"))
        user = await session.scalar(select(User).where(User.username == "+79990010101"))

    assert driver is not None
    assert user is not None
    assert driver.user_id == user.id


@pytest.mark.asyncio
async def test_driver_profile_update_resets_driver_moderation_and_updates_username(client, session_factory):
    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        driver_user = await create_user(session, username="+79990010202", role=driver_role)
        driver = Driver(
            name="Старое имя",
            phone="+79990010202",
            user_id=driver_user.id,
            status="offline",
            moderation_status=ModerationStatus.approved.value,
        )
        session.add(driver)
        await session.commit()

    response = await client.patch(
        "/api/v1/driver/profile",
        headers=auth_headers("+79990010202"),
        json={"name": "Новое имя", "phone": "+79990010203"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "Новое имя"
    assert payload["phone"] == "+79990010203"
    assert payload["moderation_status"] == ModerationStatus.pending_moderation.value

    async with session_factory() as session:
        driver = await session.scalar(select(Driver).where(Driver.phone == "+79990010203"))
        user = await session.scalar(select(User).where(User.id == driver.user_id))

    assert driver is not None
    assert user is not None
    assert user.username == "+79990010203"


@pytest.mark.asyncio
async def test_driver_vehicle_patch_creates_vehicle_and_resets_vehicle_moderation(client, session_factory):
    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        driver_user = await create_user(session, username="+79990010303", role=driver_role)
        delivery_option = await create_delivery_option(session, capacity_m3=15.0, title="Самосвал 15 м3")
        driver = Driver(
            name="Водитель без машины",
            phone="+79990010303",
            user_id=driver_user.id,
            status="offline",
            moderation_status=ModerationStatus.approved.value,
        )
        session.add(driver)
        await session.commit()
        delivery_option_id = delivery_option.id

    response = await client.patch(
        "/api/v1/driver/vehicle",
        headers=auth_headers("+79990010303"),
        json={
            "brand": "КамАЗ",
            "model": "6520",
            "plate_number": "А123АА72",
            "vehicle_type": "Самосвал",
            "body_volume_m3": 15.0,
            "delivery_option_id": str(delivery_option_id),
            "rate_mode": "fixed",
            "fixed_rate": 18000.0,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["vehicle"]["brand"] == "КамАЗ"
    assert payload["vehicle"]["model"] == "6520"
    assert payload["vehicle"]["moderation_status"] == ModerationStatus.pending_moderation.value
    assert payload["vehicle"]["fixed_rate"] == 18000.0
    assert payload["vehicle"]["rate_per_ton_km"] is None


@pytest.mark.asyncio
async def test_driver_full_profile_returns_vehicle_block(client, session_factory):
    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        driver_user = await create_user(session, username="+79990010404", role=driver_role)
        delivery_option = await create_delivery_option(session, capacity_m3=10.0, title="Самосвал 10 м3")
        vehicle = Vehicle(
            title="Truck profile",
            brand="MAN",
            model="TGS",
            plate_number="В456ВВ72",
            delivery_option_id=delivery_option.id,
            is_active=True,
            moderation_status=ModerationStatus.approved.value,
        )
        session.add(vehicle)
        await session.flush()
        driver = Driver(
            name="Водитель с машиной",
            phone="+79990010404",
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            status="offline",
            moderation_status=ModerationStatus.approved.value,
        )
        session.add(driver)
        await session.commit()

    response = await client.get(
        "/api/v1/driver/profile/full",
        headers=auth_headers("+79990010404"),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["phone"] == "+79990010404"
    assert payload["vehicle"]["brand"] == "MAN"
    assert payload["vehicle"]["media_files"] == []


@pytest.mark.asyncio
async def test_driver_order_endpoints_require_approved_driver(client, session_factory):
    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        driver_user = await create_user(session, username="+79990010505", role=driver_role)
        driver = Driver(
            name="Pending Driver",
            phone="+79990010505",
            user_id=driver_user.id,
            status="offline",
            moderation_status=ModerationStatus.pending_moderation.value,
        )
        session.add(driver)
        await session.commit()

    response = await client.get(
        "/api/v1/driver/orders",
        headers=auth_headers("+79990010505"),
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Driver moderation is not approved"


@pytest.mark.asyncio
async def test_driver_register_normalizes_phone_and_login_accepts_normalized_phone(client):
    response = await client.post(
        "/api/v1/auth/driver/register",
        json={
            "name": "Masked Driver",
            "phone": "+7 (999) 000-11-22",
            "password": "driver123",
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["driver"]["phone"] == "+79990001122"

    login_response = await client.post(
        "/api/v1/auth/login",
        data={"username": "+79990001122", "password": "driver123"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    assert login_response.status_code == 200
    assert login_response.json()["role"] == "driver"


@pytest.mark.asyncio
async def test_admin_can_approve_reject_and_suspend_driver_and_vehicle(client, session_factory):
    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        driver_role = await ensure_role(session, "driver")
        admin_user = await create_user(session, username="sprint11_admin", role=admin_role)
        driver_user = await create_user(session, username="+79990010606", role=driver_role)
        delivery_option = await create_delivery_option(session, capacity_m3=20.0, title="Самосвал 20 м3")
        vehicle = Vehicle(
            title="Truck moderation",
            delivery_option_id=delivery_option.id,
            is_active=True,
            moderation_status=ModerationStatus.pending_moderation.value,
        )
        session.add(vehicle)
        await session.flush()
        driver = Driver(
            name="Driver moderation",
            phone="+79990010606",
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            status="offline",
            moderation_status=ModerationStatus.pending_moderation.value,
        )
        session.add(driver)
        await session.commit()
        driver_id = driver.id
        vehicle_id = vehicle.id
        admin_username = admin_user.username

    approve_driver = await client.post(
        f"/api/v1/admin/drivers/{driver_id}/approve",
        headers=auth_headers(admin_username),
        json={"comment": "documents ok"},
    )
    assert approve_driver.status_code == 200
    assert approve_driver.json()["moderation_status"] == ModerationStatus.approved.value

    reject_vehicle = await client.post(
        f"/api/v1/admin/vehicles/{vehicle_id}/reject",
        headers=auth_headers(admin_username),
        json={"comment": "bad photo"},
    )
    assert reject_vehicle.status_code == 200
    assert reject_vehicle.json()["moderation_status"] == ModerationStatus.rejected.value

    suspend_driver = await client.post(
        f"/api/v1/admin/drivers/{driver_id}/suspend",
        headers=auth_headers(admin_username),
        json={"comment": "blocked"},
    )
    assert suspend_driver.status_code == 200
    assert suspend_driver.json()["moderation_status"] == ModerationStatus.suspended.value

    approve_vehicle = await client.post(
        f"/api/v1/admin/vehicles/{vehicle_id}/approve",
        headers=auth_headers(admin_username),
        json={"comment": "fixed"},
    )
    assert approve_vehicle.status_code == 200
    assert approve_vehicle.json()["moderation_status"] == ModerationStatus.approved.value

    async with session_factory() as session:
        driver = await session.get(Driver, driver_id)
        vehicle = await session.get(Vehicle, vehicle_id)

    assert driver is not None
    assert vehicle is not None
    assert driver.moderation_status == ModerationStatus.suspended.value
    assert driver.moderated_by_user_id is not None
    assert vehicle.moderation_status == ModerationStatus.approved.value


@pytest.mark.asyncio
async def test_admin_moderation_endpoints_allow_empty_body(client, session_factory):
    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        driver_role = await ensure_role(session, "driver")
        admin_user = await create_user(session, username="sprint11_admin_empty_body", role=admin_role)
        driver_user = await create_user(session, username="+79990007788", role=driver_role)
        driver = Driver(
            name="Pending Driver",
            phone="+79990007788",
            user_id=driver_user.id,
            status="offline",
            moderation_status=ModerationStatus.pending_moderation.value,
        )
        session.add(driver)
        await session.commit()
        driver_id = driver.id
        admin_username = admin_user.username

    response = await client.post(
        f"/api/v1/admin/drivers/{driver_id}/approve",
        headers=auth_headers(admin_username),
    )

    assert response.status_code == 200
    assert response.json()["moderation_status"] == ModerationStatus.approved.value
