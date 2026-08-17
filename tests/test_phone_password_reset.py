import pytest
from sqlalchemy import select

from app.models.models import Role, User
from app.security.auth import get_password_hash, verify_password


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
@pytest.mark.parametrize(
    ("role_name", "phone"),
    [("driver", "+79990001001"), ("supplier", "+79990001002")],
)
async def test_phone_password_reset_updates_allowed_account_password(
    client,
    session_factory,
    monkeypatch,
    role_name,
    phone,
):
    fake_redis = FakeRedis()
    sms_calls: list[dict[str, str]] = []

    async def fake_send_sms(**kwargs: str) -> str:
        sms_calls.append(kwargs)
        return "0000"

    monkeypatch.setattr("app.api.auth.get_redis", lambda: fake_redis)
    monkeypatch.setattr("app.api.auth.send_auth_sms_code", fake_send_sms)

    async with session_factory() as session:
        role = await ensure_role(session, role_name)
        user = User(
            username=phone,
            display_name=f"Test {role_name}",
            hashed_password=get_password_hash("old-password"),
            role_id=role.id,
            is_active=True,
        )
        session.add(user)
        await session.commit()

    request_response = await client.post(
        "/api/v1/auth/forgot-password/phone",
        json={"phone": "+7 (999) 000-10-01" if role_name == "driver" else phone},
    )

    assert request_response.status_code == 202
    assert request_response.json() == {"ok": True, "status": "sms_sent"}
    assert fake_redis.storage[f"reset_otp:phone:{phone}"] == "0000"
    assert fake_redis.ttl_by_key[f"reset_otp:phone:{phone}"] == 300
    assert sms_calls == [
        {
            "phone_number": phone.removeprefix("+"),
            "code": "0000",
            "log_prefix": "phone_password_reset_sms",
        }
    ]

    invalid_code_response = await client.post(
        "/api/v1/auth/forgot-password/verify-phone",
        json={"phone": phone, "code": "1111"},
    )
    assert invalid_code_response.status_code == 400

    verify_response = await client.post(
        "/api/v1/auth/forgot-password/verify-phone",
        json={"phone": phone, "code": "0000"},
    )

    assert verify_response.status_code == 200
    verify_payload = verify_response.json()
    assert verify_payload["role"] == role_name
    assert verify_payload["phone"] == phone
    assert verify_payload["reset_token"]
    assert f"reset_otp:phone:{phone}" not in fake_redis.storage
    token_key = f"reset_token:phone:{verify_payload['reset_token']}"
    assert token_key in fake_redis.storage
    assert fake_redis.ttl_by_key[token_key] == 600

    reset_response = await client.post(
        "/api/v1/auth/forgot-password/reset-phone",
        json={"phone": phone, "reset_token": verify_payload["reset_token"], "new_password": "new-password"},
    )

    assert reset_response.status_code == 200
    assert reset_response.json() == {"ok": True}
    assert token_key not in fake_redis.storage

    async with session_factory() as session:
        user = await session.scalar(select(User).where(User.username == phone))
        assert user is not None
        assert verify_password("new-password", user.hashed_password)
        assert user.auth_version == 2


@pytest.mark.asyncio
async def test_phone_password_reset_does_not_issue_code_for_unsupported_role(client, session_factory, monkeypatch):
    fake_redis = FakeRedis()
    sms_calls: list[dict[str, str]] = []

    async def fake_send_sms(**kwargs: str) -> str:
        sms_calls.append(kwargs)
        return "0000"

    monkeypatch.setattr("app.api.auth.get_redis", lambda: fake_redis)
    monkeypatch.setattr("app.api.auth.send_auth_sms_code", fake_send_sms)

    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        session.add(
            User(
                username="+79990001003",
                hashed_password=get_password_hash("admin-password"),
                role_id=admin_role.id,
                is_active=True,
            )
        )
        await session.commit()

    response = await client.post(
        "/api/v1/auth/forgot-password/phone",
        json={"phone": "+79990001003"},
    )

    assert response.status_code == 202
    assert response.json() == {"ok": True, "status": "sms_sent"}
    assert fake_redis.storage == {}
    assert sms_calls == []
