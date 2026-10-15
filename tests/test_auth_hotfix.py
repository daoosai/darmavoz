import uuid

import pytest
from sqlalchemy import select

from app.db import seed
from app.models.models import Driver, Role, User
from app.security.auth import get_password_hash, verify_password
from tests.test_driver_auth_otp import FakeRedis, ensure_role


@pytest.mark.asyncio
@pytest.mark.parametrize("username", ["hotfix-admin", "hotfix_admin", "hotfix123"])
async def test_employee_literal_username(client, session_factory, username):
    async with session_factory() as session:
        role = await ensure_role(session, "admin")
        session.add(User(username=username, hashed_password=get_password_hash("test-password"), role_id=role.id))
        await session.commit()
    response = await client.post("/api/v1/auth/login", data={"username": username, "password": "test-password"})
    assert response.status_code == 200
    assert response.json()["role"] == "admin"
    wrong = await client.post("/api/v1/auth/login", data={"username": username, "password": "wrong"})
    assert wrong.status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize("stored_username", ["79041146001", "89041146002", "driver-hotfix"])
async def test_driver_phone_alias_full_login(client, session_factory, monkeypatch, stored_username):
    fake_redis = FakeRedis()
    monkeypatch.setattr("app.api.auth.get_redis", lambda: fake_redis)
    suffix = {"79041146001": "001", "89041146002": "002", "driver-hotfix": "003"}[stored_username]
    phone = "+79041146" + suffix
    async with session_factory() as session:
        role = await ensure_role(session, "driver")
        user = User(username=stored_username, hashed_password=get_password_hash("driver-password"), role_id=role.id)
        session.add(user)
        await session.flush()
        session.add(Driver(name="Hotfix regression", phone=phone, user_id=user.id, status="offline", moderation_status="incomplete"))
        await session.commit()
    response = await client.post("/api/v1/auth/login", data={"username": phone, "password": "driver-password"})
    assert response.status_code == 200
    assert response.json() == {"status": "sms_sent", "phone": phone}
    verified = await client.post("/api/v1/driver/auth/verify-login", json={"phone": phone, "code": "0000"})
    assert verified.status_code == 200
    assert verified.json()["role"] == "driver"
    assert verified.json()["access_token"]


@pytest.mark.asyncio
async def test_seed_preserves_existing_admin_password(session_factory, monkeypatch):
    username = "bootstrap-" + uuid.uuid4().hex[:12]
    monkeypatch.setattr(seed, "AsyncSessionLocal", session_factory)
    monkeypatch.setattr(seed.settings, "ADMIN_USERNAME", username)
    monkeypatch.setattr(seed.settings, "ADMIN_PASSWORD", "bootstrap-password")
    monkeypatch.setattr(seed.settings, "LOGIST_USERNAME", None)
    monkeypatch.setattr(seed.settings, "MANAGER_USERNAME", None)
    await seed.seed_data()
    async with session_factory() as session:
        user = await session.scalar(select(User).where(User.username == username))
        assert verify_password("bootstrap-password", user.hashed_password)
        user.hashed_password = get_password_hash("changed-password")
        await session.commit()
    await seed.seed_data()
    async with session_factory() as session:
        user = await session.scalar(select(User).where(User.username == username))
        assert verify_password("changed-password", user.hashed_password)
