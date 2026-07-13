import pytest
from sqlalchemy import select

from app.models.models import Driver, ModerationStatus, Role, User
from app.security.auth import get_password_hash


class FakeRedis:
    def __init__(self) -> None:
        self.storage: dict[str, str] = {}
        self.ttl_by_key: dict[str, int] = {}

    async def setex(self, key: str, ttl: int, value: str) -> None:
        self.storage[key] = value
        self.ttl_by_key[key] = ttl

    async def get(self, key: str) -> str | None:
        return self.storage.get(key)

    async def delete(self, key: str) -> None:
        self.storage.pop(key, None)
        self.ttl_by_key.pop(key, None)


async def ensure_role(session, name: str) -> Role:
    role = await session.scalar(select(Role).where(Role.name == name))
    if role is None:
        role = Role(name=name, description=name)
        session.add(role)
        await session.flush()
    return role


@pytest.mark.asyncio
async def test_driver_register_requires_otp_before_creating_driver(client, session_factory, monkeypatch):
    fake_redis = FakeRedis()
    monkeypatch.setattr("app.api.auth.get_redis", lambda: fake_redis)

    payload = {
        "phone": "+7 (999) 123-45-67",
        "password": "driver123",
        "name": "Новый водитель",
        "vehicle_brand": "КАМАЗ",
        "vehicle_plate_number": "А123АА72",
        "cubature_min": 10.0,
        "cubature_max": 14.0,
        "tonnage_min": 8.0,
        "tonnage_max": 12.0,
        "vehicle_type": "Самосвал",
    }

    challenge_response = await client.post("/api/v1/auth/driver/register", json=payload)

    assert challenge_response.status_code == 202
    assert challenge_response.json() == {"status": "sms_sent", "phone": "+79991234567"}
    assert fake_redis.storage["otp:driver_register:+79991234567"] == "0000"
    assert fake_redis.storage["otp:driver_register_pending:+79991234567"]

    async with session_factory() as session:
        driver = await session.scalar(select(Driver).where(Driver.phone == "+79991234567"))

    assert driver is None

    verify_response = await client.post(
        "/api/v1/driver/auth/verify-register",
        json={"phone": "+79991234567", "code": "0000"},
    )

    assert verify_response.status_code == 200
    verify_payload = verify_response.json()
    assert verify_payload["role"] == "driver"
    assert verify_payload["driver"]["phone"] == "+79991234567"
    assert verify_payload["driver"]["moderation_status"] == ModerationStatus.incomplete.value
    assert verify_payload["access_token"]
    assert "otp:driver_register:+79991234567" not in fake_redis.storage
    assert "otp:driver_register_pending:+79991234567" not in fake_redis.storage


@pytest.mark.asyncio
async def test_driver_login_returns_sms_challenge_and_verify_issues_token(client, session_factory, monkeypatch):
    fake_redis = FakeRedis()
    monkeypatch.setattr("app.api.auth.get_redis", lambda: fake_redis)

    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        user = User(
            username="+79990000011",
            hashed_password=get_password_hash("driver123"),
            role_id=driver_role.id,
            is_active=True,
        )
        session.add(user)
        await session.flush()
        driver = Driver(
            name="OTP Driver",
            phone="+79990000011",
            user_id=user.id,
            status="offline",
            moderation_status=ModerationStatus.incomplete.value,
        )
        session.add(driver)
        await session.commit()
        await session.refresh(driver)

    login_response = await client.post(
        "/api/v1/auth/login",
        data={"username": "+7 (999) 000-00-11", "password": "driver123"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    assert login_response.status_code == 200
    assert login_response.json() == {"status": "sms_sent", "phone": "+79990000011"}
    assert fake_redis.storage["otp:driver_login:+79990000011"] == "0000"
    assert fake_redis.storage["otp:driver_login_pending:+79990000011"]

    verify_response = await client.post(
        "/api/v1/driver/auth/verify-login",
        json={"phone": "+79990000011", "code": "0000"},
    )

    assert verify_response.status_code == 200
    verify_payload = verify_response.json()
    assert verify_payload["role"] == "driver"
    assert verify_payload["driver_id"] == str(driver.id)
    assert verify_payload["access_token"]
    assert "otp:driver_login:+79990000011" not in fake_redis.storage
    assert "otp:driver_login_pending:+79990000011" not in fake_redis.storage


@pytest.mark.asyncio
async def test_non_driver_login_still_returns_token_without_otp(client, session_factory):
    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        admin = User(
            username="admin_otp_test",
            hashed_password=get_password_hash("admin123"),
            role_id=admin_role.id,
            is_active=True,
        )
        session.add(admin)
        await session.commit()

    response = await client.post(
        "/api/v1/auth/login",
        data={"username": "admin_otp_test", "password": "admin123"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["role"] == "admin"
    assert payload["access_token"]
