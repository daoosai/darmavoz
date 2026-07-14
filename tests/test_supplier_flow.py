import pytest
from sqlalchemy import func, select

from app.models.models import Quarry, Role, User


class FakeRedis:
    def __init__(self) -> None:
        self.storage: dict[str, str] = {}

    async def setex(self, key: str, ttl: int, value: str) -> None:
        self.storage[key] = value

    async def get(self, key: str) -> str | None:
        return self.storage.get(key)

    async def delete(self, key: str) -> None:
        self.storage.pop(key, None)


@pytest.mark.asyncio
async def test_supplier_auth_creates_only_user_and_allows_multiple_points(
    client,
    session_factory,
    monkeypatch,
):
    fake_redis = FakeRedis()

    async def fake_send_sms(**_kwargs) -> str:
        return "0000"

    monkeypatch.setattr("app.api.supplier_auth.get_redis", lambda: fake_redis)
    monkeypatch.setattr("app.api.supplier_auth.send_auth_sms_code", fake_send_sms)

    async with session_factory() as session:
        points_before_registration = await session.scalar(select(func.count()).select_from(Quarry))

    challenge = await client.post(
        "/api/v1/auth/supplier/register",
        json={"phone": "+7 (999) 555-01-01"},
    )

    assert challenge.status_code == 202
    assert challenge.json() == {"status": "sms_sent", "phone": "+79995550101"}

    async with session_factory() as session:
        assert await session.scalar(
            select(User.id).where(User.username == "+79995550101")
        ) is None
        assert await session.scalar(select(func.count()).select_from(Quarry)) == points_before_registration

    verification = await client.post(
        "/api/v1/auth/supplier/register/verify",
        json={"phone": "+79995550101", "code": "0000"},
    )

    assert verification.status_code == 200
    auth_payload = verification.json()
    assert auth_payload["role"] == "supplier"
    assert auth_payload["token_type"] == "bearer"
    assert auth_payload["access_token"]
    assert "point" not in auth_payload
    assert "point_id" not in auth_payload

    async with session_factory() as session:
        user_role = await session.execute(
            select(User.username, Role.name).join(Role).where(User.username == "+79995550101")
        )
        assert user_role.one() == ("+79995550101", "supplier")
        assert await session.scalar(select(func.count()).select_from(Quarry)) == points_before_registration

    point_payload = {
        "name": "Test point",
        "short_name": "Point",
        "point_type": "quarry",
        "address": "Test address",
        "description": None,
        "lat": 57.15,
        "lon": 65.53,
        "material_offers": [],
    }
    unauthorized = await client.post("/api/v1/supplier/points", json=point_payload)
    assert unauthorized.status_code == 401

    headers = {"Authorization": f"Bearer {auth_payload['access_token']}"}
    first_point = await client.post("/api/v1/supplier/points", json=point_payload, headers=headers)
    second_point = await client.post(
        "/api/v1/supplier/points",
        json={
            **point_payload,
            "name": "Test warehouse",
            "short_name": "Warehouse",
            "point_type": "warehouse",
        },
        headers=headers,
    )

    assert first_point.status_code == 201
    assert second_point.status_code == 201
    assert first_point.json()["owner_user_id"] == second_point.json()["owner_user_id"]

    points = await client.get("/api/v1/supplier/points", headers=headers)
    assert points.status_code == 200
    assert {point["name"] for point in points.json()} == {"Test point", "Test warehouse"}

    second_challenge = await client.post(
        "/api/v1/auth/supplier/register",
        json={"phone": "+79995550101"},
    )
    second_verification = await client.post(
        "/api/v1/auth/supplier/register/verify",
        json={"phone": "+79995550101", "code": "0000"},
    )
    assert second_challenge.status_code == 202
    assert second_verification.status_code == 200
