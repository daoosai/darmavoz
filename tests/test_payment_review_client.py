import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models.models import Client
from tests.test_driver_auth_otp import FakeRedis


@pytest.fixture
def review_redis(monkeypatch):
    redis = FakeRedis()
    monkeypatch.setattr("app.api.client_auth.get_redis", lambda: redis)
    return redis


@pytest.mark.asyncio
@pytest.mark.parametrize("phone", ["+79999999999", "79999999999", "+7 (999) 999-99-99", "89999999999", "9999999999"])
async def test_review_client_skips_sms_and_receives_only_client_token(
    client, session_factory, monkeypatch, review_redis, phone
):
    monkeypatch.setattr(settings, "USE_REAL_SMS", True)

    async def forbidden_provider(**kwargs):
        raise AssertionError("Review number must never contact the SMS provider")

    monkeypatch.setattr("app.api.client_auth.send_auth_sms_code", forbidden_provider)
    response = await client.post("/api/v1/auth/client/send-code", json={"phone": phone})
    assert response.status_code == 200
    assert review_redis.storage["otp:client:79999999999"] == "0000"
    response = await client.post("/api/v1/auth/client/verify-code", json={"phone": phone, "code": "0000"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["role"] == "client"
    headers = {"Authorization": "Bearer " + payload["access_token"]}
    assert (await client.get("/api/v1/clients/me", headers=headers)).status_code == 200
    assert (await client.get("/api/v1/admin/users", headers=headers)).status_code in (401, 403)
    async with session_factory() as session:
        records = (await session.scalars(select(Client).where(Client.phone == "+79999999999"))).all()
    assert len(records) == 1
    assert str(records[0].id) == payload["client_id"]


@pytest.mark.asyncio
async def test_review_client_repeated_login_without_challenge(client, review_redis):
    responses = [await client.post("/api/v1/auth/client/verify-code", json={"phone": "+79999999999", "code": "0000"}) for _ in range(2)]
    assert all(response.status_code == 200 for response in responses)
    assert responses[0].json()["client_id"] == responses[1].json()["client_id"]
    assert "otp:client:79999999999" not in review_redis.storage


@pytest.mark.asyncio
async def test_review_client_rejects_non_review_code(client, review_redis):
    review_redis.storage["otp:client:79999999999"] = "1234"
    response = await client.post("/api/v1/auth/client/verify-code", json={"phone": "+79999999999", "code": "1234"})
    assert response.status_code == 400


@pytest.mark.asyncio
@pytest.mark.parametrize("phone", ["+79999999998", "+79999999990", "+79995550123", "+70000000000"])
async def test_production_other_numbers_cannot_use_0000(client, review_redis, monkeypatch, phone):
    monkeypatch.setattr(settings, "USE_REAL_SMS", True)
    review_redis.storage["otp:client:" + phone[1:]] = "0000"
    response = await client.post("/api/v1/auth/client/verify-code", json={"phone": phone, "code": "0000"})
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_normal_client_still_requires_own_production_code(client, review_redis, monkeypatch):
    monkeypatch.setattr(settings, "USE_REAL_SMS", True)
    phone = "+79995550124"
    review_redis.storage["otp:client:" + phone[1:]] = "4281"
    response = await client.post("/api/v1/auth/client/verify-code", json={"phone": phone, "code": "0000"})
    assert response.status_code == 400
    response = await client.post("/api/v1/auth/client/verify-code", json={"phone": phone, "code": "4281"})
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_test_sandbox_keeps_0000_for_normal_client(client, review_redis, monkeypatch):
    monkeypatch.setattr(settings, "USE_REAL_SMS", False)
    phone = "+79995550125"
    review_redis.storage["otp:client:" + phone[1:]] = "0000"
    response = await client.post("/api/v1/auth/client/verify-code", json={"phone": phone, "code": "0000"})
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_review_client_cannot_authenticate_employee_with_same_phone(
    client, session_factory, review_redis
):
    from app.models.models import Role, User

    async with session_factory() as session:
        role = await session.scalar(select(Role).where(Role.name == "admin"))
        if role is None:
            role = Role(name="admin", description="Test admin")
            session.add(role)
            await session.flush()
        session.add(User(username="+79999999999", hashed_password="test-only",
                         role_id=role.id, is_active=True, auth_version=1))
        await session.commit()
    response = await client.post("/api/v1/auth/client/verify-code",
                                 json={"phone": "+79999999999", "code": "0000"})
    assert response.status_code == 200
    headers = {"Authorization": "Bearer " + response.json()["access_token"]}
    assert (await client.get("/api/v1/clients/me", headers=headers)).status_code == 200
    assert (await client.get("/api/v1/admin/users", headers=headers)).status_code == 401


@pytest.mark.asyncio
async def test_review_phone_does_not_bypass_shared_employee_otp(monkeypatch):
    from app.services.sms_service import validate_sms_otp

    monkeypatch.setattr(settings, "USE_REAL_SMS", True)
    assert not await validate_sms_otp(redis=FakeRedis(), phone_number="+79999999999",
                                      otp_key="otp:driver_login:79999999999",
                                      submitted_code="0000", stored_code="0000")
