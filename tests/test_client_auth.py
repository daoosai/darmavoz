import pytest
from sqlalchemy import select

from app.models.models import Client
from app.security.jwt import create_access_token


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


def client_auth_headers(*, phone: str, client_id) -> dict[str, str]:
    token = create_access_token(data={"sub": phone, "role": "client", "client_id": str(client_id)})
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_send_code_returns_is_new_user_and_persists_code(client, session_factory, monkeypatch):
    fake_redis = FakeRedis()
    monkeypatch.setattr("app.api.client_auth.get_redis", lambda: fake_redis)

    async with session_factory() as session:
        session.add(Client(name="Existing Client", email="existing@example.com", phone="+79990000001"))
        await session.commit()

    existing_response = await client.post("/api/v1/auth/client/send-code", json={"phone_number": "+7 (999) 000-00-01"})
    new_response = await client.post("/api/v1/auth/client/send-code", json={"phone_number": "+7 999 000 00 02"})

    assert existing_response.status_code == 200
    assert existing_response.json() == {"ok": True, "is_new_user": False}
    assert new_response.status_code == 200
    assert new_response.json() == {"ok": True, "is_new_user": True}
    assert fake_redis.storage["client_auth_code:+79990000001"] == "0000"
    assert fake_redis.ttl_by_key["client_auth_code:+79990000001"] == 300
    assert fake_redis.storage["client_auth_code:+79990000002"] == "0000"

    async with session_factory() as session:
        created = await session.scalar(select(Client).where(Client.phone == "+79990000002"))

    assert created is not None
    assert created.name == "Клиент 0002"


@pytest.mark.asyncio
async def test_register_creates_client_and_rejects_duplicate_phone(client, session_factory, monkeypatch):
    fake_redis = FakeRedis()
    monkeypatch.setattr("app.api.client_auth.get_redis", lambda: fake_redis)

    response = await client.post(
        "/api/v1/auth/client/register",
        json={"email": "fresh@example.com", "phone_number": "+7 (999) 000-00-12", "name": "Fresh Client"},
    )

    assert response.status_code == 201
    assert response.json() == {"ok": True, "is_new_user": True}

    async with session_factory() as session:
        created = await session.scalar(select(Client).where(Client.phone == "+79990000012"))

    assert created is not None
    assert created.phone == "+79990000012"
    assert created.email == "fresh@example.com"
    assert created.name == "Fresh Client"

    duplicate_response = await client.post(
        "/api/v1/auth/client/register",
        json={"email": "other@example.com", "phone_number": "+79990000012", "name": "Other Client"},
    )

    assert duplicate_response.status_code == 409
    assert duplicate_response.json()["detail"] == "Client with this phone already exists"


@pytest.mark.asyncio
async def test_verify_code_accepts_mocked_code_and_returns_client_token(client, session_factory, monkeypatch):
    fake_redis = FakeRedis()
    fake_redis.storage["client_auth_code:+79990000003"] = "0000"
    fake_redis.ttl_by_key["client_auth_code:+79990000003"] = 300
    monkeypatch.setattr("app.api.client_auth.get_redis", lambda: fake_redis)

    async with session_factory() as session:
        client_record = Client(name="Bypass Client", email="bypass@example.com", phone="+79990000003")
        session.add(client_record)
        await session.commit()
        await session.refresh(client_record)

    response = await client.post(
        "/api/v1/auth/client/verify-code",
        json={"phone_number": "+7 (999) 000-00-03", "code": "0000"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["role"] == "client"
    assert payload["client_id"] == str(client_record.id)
    assert payload["token_type"] == "bearer"
    assert payload["access_token"]
    assert "client_auth_code:+79990000003" not in fake_redis.storage


@pytest.mark.asyncio
async def test_client_me_returns_current_profile(client, session_factory):
    async with session_factory() as session:
        client_record = Client(name="Иван Петров", email="profile@example.com", phone="+79990000004")
        session.add(client_record)
        await session.commit()
        await session.refresh(client_record)

    response = await client.get(
        "/api/v1/clients/me",
        headers=client_auth_headers(phone="+79990000004", client_id=client_record.id),
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": str(client_record.id),
        "first_name": "Иван",
        "last_name": "Петров",
        "name": "Иван Петров",
        "phone": "+79990000004",
        "created_at": client_record.created_at.isoformat().replace("+00:00", "Z"),
    }


@pytest.mark.asyncio
async def test_client_me_patch_updates_first_and_last_name(client, session_factory):
    async with session_factory() as session:
        client_record = Client(name="Иван Петров", phone="+79990000005")
        session.add(client_record)
        await session.commit()
        await session.refresh(client_record)

    response = await client.patch(
        "/api/v1/clients/me",
        json={"first_name": "Павел", "last_name": "Иванов"},
        headers=client_auth_headers(phone="+79990000005", client_id=client_record.id),
    )

    assert response.status_code == 200
    assert response.json()["first_name"] == "Павел"
    assert response.json()["last_name"] == "Иванов"
    assert response.json()["name"] == "Павел Иванов"

    async with session_factory() as session:
        updated = await session.get(Client, client_record.id)

    assert updated is not None
    assert updated.name == "Павел Иванов"
