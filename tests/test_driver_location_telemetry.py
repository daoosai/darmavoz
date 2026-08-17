from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models.models import Client, Driver, Order, OrderStatus, Role, User, Vehicle
from app.security.auth import get_password_hash
from app.security.jwt import create_access_token


def auth_headers(username: str) -> dict[str, str]:
    token = create_access_token(data={"sub": username})
    return {"Authorization": f"Bearer {token}"}


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    async def set(self, key: str, value: str, ex: int) -> bool:
        assert ex == 120
        self.values[key] = value
        return True

    async def delete(self, key: str) -> int:
        return int(self.values.pop(key, None) is not None)

    async def mget(self, keys: list[str]) -> list[str | None]:
        return [self.values.get(key) for key in keys]


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
async def test_driver_location_updates_redis_database_and_logist_map(
    client,
    session_factory,
    monkeypatch,
):
    fake_redis = FakeRedis()
    monkeypatch.setattr("app.services.driver_locations.get_redis", lambda: fake_redis)

    async with session_factory() as session:
        logist_role = await ensure_role(session, "logist")
        driver_role = await ensure_role(session, "driver")
        logist_user = await create_user(session, username="telemetry-logist", role=logist_role)
        driver_user = await create_user(session, username="telemetry-driver", role=driver_role)
        second_driver_user = await create_user(session, username="telemetry-driver-second", role=driver_role)
        vehicle = Vehicle(
            title="Самосвал 20 м3",
            plate_number="А123АА72",
            vehicle_type="самосвал",
            cubature_min=17.0,
            cubature_max=20.0,
            is_active=True,
            moderation_status="approved",
        )
        session.add(vehicle)
        await session.flush()
        driver = Driver(
            name="Водитель телеметрии",
            phone="+79990012001",
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            status="offline",
            is_active=True,
            moderation_status="approved",
        )
        session.add(driver)
        second_driver = Driver(
            name="Второй водитель телеметрии",
            phone="+79990012005",
            user_id=second_driver_user.id,
            vehicle_id=vehicle.id,
            status="offline",
            is_active=True,
            moderation_status="approved",
        )
        session.add(second_driver)
        await session.commit()
        driver_id = driver.id
        second_driver_id = second_driver.id

    shift_response = await client.patch(
        "/api/v1/driver/profile/shift",
        json={"is_on_shift": True},
        headers=auth_headers("telemetry-driver"),
    )
    assert shift_response.status_code == 200
    assert shift_response.json()["is_on_shift"] is True
    assert shift_response.json()["status"] == "available"

    second_shift_response = await client.patch(
        "/api/v1/driver/profile/shift",
        json={"is_on_shift": True},
        headers=auth_headers("telemetry-driver-second"),
    )
    assert second_shift_response.status_code == 200
    assert second_shift_response.json()["status"] == "available"

    location_response = await client.post(
        "/api/v1/driver/location",
        json={"lat": 57.152286, "lon": 65.534328},
        headers=auth_headers("telemetry-driver"),
    )
    assert location_response.status_code == 200
    assert location_response.json()["ok"] is True
    assert fake_redis.values

    second_location_response = await client.post(
        "/api/v1/driver/location",
        json={"lat": 57.252286, "lon": 65.634328},
        headers=auth_headers("telemetry-driver-second"),
    )
    assert second_location_response.status_code == 200

    async with session_factory() as session:
        driver = await session.get(Driver, driver_id)
        assert driver is not None
        assert driver.last_lat == 57.152286
        assert driver.last_lon == 65.534328
        assert driver.last_location_updated_at is not None
        assert driver.status == "available"

    map_response = await client.get(
        "/api/v1/logist/driver-map",
        headers=auth_headers("telemetry-logist"),
    )
    assert map_response.status_code == 200
    payload = map_response.json()
    assert {str(driver_id), str(second_driver_id)}.issubset({item["id"] for item in payload})
    driver_payload = next(item for item in payload if item["id"] == str(driver_id))
    assert driver_payload["map_status"] == "available"
    assert driver_payload["last_location_is_stale"] is False
    assert driver_payload["vehicle_cubature_max"] == 20.0

    shift_off_response = await client.patch(
        "/api/v1/driver/profile/shift",
        json={"is_on_shift": False},
        headers=auth_headers("telemetry-driver"),
    )
    assert shift_off_response.status_code == 200
    assert shift_off_response.json()["status"] == "offline"


@pytest.mark.asyncio
async def test_driver_map_marks_busy_and_stale_locations(client, session_factory, monkeypatch):
    fake_redis = FakeRedis()
    monkeypatch.setattr("app.services.driver_locations.get_redis", lambda: fake_redis)

    async with session_factory() as session:
        logist_role = await ensure_role(session, "logist")
        driver_role = await ensure_role(session, "driver")
        await create_user(session, username="telemetry-logist-busy", role=logist_role)
        driver_user = await create_user(session, username="telemetry-driver-busy", role=driver_role)
        vehicle = Vehicle(title="Самосвал", is_active=True, moderation_status="approved")
        client_record = Client(name="Клиент телеметрии", phone="+79990012002")
        session.add_all([vehicle, client_record])
        await session.flush()
        driver = Driver(
            name="Занятый водитель",
            phone="+79990012003",
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            status="offline",
            is_active=True,
            is_on_shift=True,
            moderation_status="approved",
            last_lat=57.15,
            last_lon=65.53,
            last_location_updated_at=datetime.now(UTC),
        )
        session.add(driver)
        await session.flush()
        order = Order(
            client_id=client_record.id,
            driver_id=driver.id,
            status=OrderStatus.heading_to_pickup.value,
            total_amount=0.0,
        )
        session.add(order)
        await session.commit()
        driver_id = driver.id

    shift_response = await client.patch(
        "/api/v1/driver/profile/shift",
        json={"is_on_shift": True},
        headers=auth_headers("telemetry-driver-busy"),
    )
    assert shift_response.status_code == 200
    assert shift_response.json()["status"] == "busy"

    busy_response = await client.get(
        "/api/v1/logist/driver-map",
        headers=auth_headers("telemetry-logist-busy"),
    )
    assert busy_response.status_code == 200
    busy_payload = next(item for item in busy_response.json() if item["id"] == str(driver_id))
    assert busy_payload["map_status"] == "busy"

    async with session_factory() as session:
        driver = await session.get(Driver, driver_id)
        assert driver is not None
        driver.last_location_updated_at = datetime.now(UTC) - timedelta(minutes=3)
        await session.commit()

    stale_response = await client.get(
        "/api/v1/logist/driver-map",
        headers=auth_headers("telemetry-logist-busy"),
    )
    assert stale_response.status_code == 200
    stale_payload = next(item for item in stale_response.json() if item["id"] == str(driver_id))
    assert stale_payload["map_status"] == "offline"
    assert stale_payload["last_location_is_stale"] is True


@pytest.mark.asyncio
async def test_driver_location_requires_shift_and_valid_coordinates(client, session_factory, monkeypatch):
    fake_redis = FakeRedis()
    monkeypatch.setattr("app.services.driver_locations.get_redis", lambda: fake_redis)

    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        driver_user = await create_user(session, username="telemetry-driver-offline", role=driver_role)
        driver = Driver(
            name="Водитель вне смены",
            phone="+79990012004",
            user_id=driver_user.id,
            status="offline",
            is_active=True,
            moderation_status="approved",
        )
        session.add(driver)
        await session.commit()

    headers = auth_headers("telemetry-driver-offline")
    off_shift_response = await client.post(
        "/api/v1/driver/location",
        json={"lat": 57.15, "lon": 65.53},
        headers=headers,
    )
    assert off_shift_response.status_code == 409

    invalid_coordinate_response = await client.post(
        "/api/v1/driver/location",
        json={"lat": 91, "lon": 65.53},
        headers=headers,
    )
    assert invalid_coordinate_response.status_code == 422

    invalid_longitude_response = await client.post(
        "/api/v1/driver/location",
        json={"lat": 57.15, "lon": 181},
        headers=headers,
    )
    assert invalid_longitude_response.status_code == 422
