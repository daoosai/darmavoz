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
async def test_admin_cars_stats_groups_approved_cars_by_volume(client, session_factory):
    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        driver_role = await ensure_role(session, "driver")
        admin_user = await create_user(session, username="+79990021000", role=admin_role)
        driver_user_1 = await create_user(session, username="+79990021001", role=driver_role)
        driver_user_2 = await create_user(session, username="+79990021002", role=driver_role)
        driver_user_3 = await create_user(session, username="+79990021003", role=driver_role)

        option_5 = await create_delivery_option(session, capacity_m3=5.0, title="5 ?3")
        option_20 = await create_delivery_option(session, capacity_m3=20.0, title="20 ?3")
        option_25 = await create_delivery_option(session, capacity_m3=25.0, title="25 ?3")

        vehicle_5 = Vehicle(
            title="Truck 5",
            body_volume_m3=5.0,
            vehicle_type="????????",
            delivery_option_id=option_5.id,
            is_active=True,
            moderation_status=ModerationStatus.approved.value,
        )
        vehicle_20 = Vehicle(
            title="Truck 20",
            delivery_option_id=option_20.id,
            is_active=True,
            moderation_status=ModerationStatus.approved.value,
        )
        vehicle_25_rejected = Vehicle(
            title="Truck 25",
            delivery_option_id=option_25.id,
            is_active=True,
            moderation_status=ModerationStatus.rejected.value,
        )
        session.add_all([vehicle_5, vehicle_20, vehicle_25_rejected])
        await session.flush()

        session.add_all(
            [
                Driver(
                    name="???????? 5",
                    phone="+79990021001",
                    user_id=driver_user_1.id,
                    vehicle_id=vehicle_5.id,
                    status="available",
                    is_active=True,
                    moderation_status=ModerationStatus.approved.value,
                ),
                Driver(
                    name="???????? 20",
                    phone="+79990021002",
                    user_id=driver_user_2.id,
                    vehicle_id=vehicle_20.id,
                    status="busy",
                    is_active=True,
                    moderation_status=ModerationStatus.approved.value,
                ),
                Driver(
                    name="??????????? ????????",
                    phone="+79990021003",
                    user_id=driver_user_3.id,
                    vehicle_id=vehicle_25_rejected.id,
                    status="available",
                    is_active=True,
                    moderation_status=ModerationStatus.rejected.value,
                ),
            ]
        )
        await session.commit()

    response = await client.get("/api/v1/admin/cars/stats", headers=auth_headers(admin_user.username))

    assert response.status_code == 200
    assert response.json() == {"5": 1, "10": 0, "17": 0, "20": 1, "25": 0, "30": 0}


@pytest.mark.asyncio
async def test_admin_cars_list_supports_filters_and_nested_driver(client, session_factory):
    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        driver_role = await ensure_role(session, "driver")
        admin_user = await create_user(session, username="+79990022000", role=admin_role)
        driver_user_1 = await create_user(session, username="+79990022001", role=driver_role)
        driver_user_2 = await create_user(session, username="+79990022002", role=driver_role)

        option_20 = await create_delivery_option(session, capacity_m3=20.0, title="20 ?3")

        available_vehicle = Vehicle(
            title="???????? ???????",
            body_volume_m3=20.0,
            plate_number="?123??72",
            vehicle_type="????????",
            delivery_option_id=option_20.id,
            is_active=True,
            moderation_status=ModerationStatus.approved.value,
        )
        blocked_vehicle = Vehicle(
            title="????????????? ????",
            body_volume_m3=20.0,
            plate_number="?999??72",
            vehicle_type="????????",
            delivery_option_id=option_20.id,
            is_active=False,
            moderation_status=ModerationStatus.approved.value,
        )
        session.add_all([available_vehicle, blocked_vehicle])
        await session.flush()

        available_driver = Driver(
            name="???? ??????",
            phone="+79990022001",
            user_id=driver_user_1.id,
            vehicle_id=available_vehicle.id,
            status="available",
            is_active=True,
            moderation_status=ModerationStatus.approved.value,
        )
        blocked_driver = Driver(
            name="?????? ???????",
            phone="+79990022002",
            user_id=driver_user_2.id,
            vehicle_id=blocked_vehicle.id,
            status="busy",
            is_active=True,
            moderation_status=ModerationStatus.approved.value,
        )
        session.add_all([available_driver, blocked_driver])
        await session.flush()

        session.add(
            MediaFile(
                entity_type="vehicle",
                entity_id=available_vehicle.id,
                bucket="media",
                object_key="vehicles/admin-main.jpg",
                public_url="https://public.example/admin-main.jpg",
                content_type="image/jpeg",
                file_name="admin-main.jpg",
                file_size=12345,
                sort_order=0,
                slot_key="vehicle_main",
                is_primary=True,
            )
        )
        await session.commit()
        blocked_driver_id = blocked_driver.id

    response = await client.get(
        "/api/v1/admin/cars",
        params={
            "volume": 20,
            "car_type": "????????",
            "status": "????????",
            "plate_number": "?123",
            "driver_name": "????",
        },
        headers=auth_headers(admin_user.username),
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0] == {
        "id": str(payload[0]["id"]),
        "plate_number": "?123??72",
        "volume": 20.0,
        "car_type": "????????",
        "photo_url": "https://public.example/admin-main.jpg",
        "driver": {
            "id": str(payload[0]["driver"]["id"]),
            "name": "???? ??????",
            "phone": "+79990022001",
            "status": "????????",
        },
    }

    blocked_response = await client.get(
        "/api/v1/admin/cars",
        params={"status": "????????????", "driver_id": str(blocked_driver_id)},
        headers=auth_headers(admin_user.username),
    )

    assert blocked_response.status_code == 200
    blocked_payload = blocked_response.json()
    assert len(blocked_payload) == 1
    assert blocked_payload[0]["plate_number"] == "?999??72"
    assert blocked_payload[0]["driver"]["name"] == "?????? ???????"
    assert blocked_payload[0]["driver"]["status"] == "????????????"
