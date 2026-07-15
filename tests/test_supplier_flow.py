from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from app.models.models import (
    Category,
    DeliveryOption,
    Material,
    MediaFile,
    ModerationStatus,
    Quarry,
    Role,
    User,
    quarry_materials,
)


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
    profile = await client.get("/api/v1/supplier/me", headers=headers)
    assert profile.status_code == 200
    assert profile.json() == {
        "phone": "+79995550101",
        "display_name": None,
    }

    updated_profile = await client.patch(
        "/api/v1/supplier/me",
        json={"display_name": "Test Quarry LLC"},
        headers=headers,
    )
    assert updated_profile.status_code == 200
    assert updated_profile.json()["display_name"] == "Test Quarry LLC"

    first_point = await client.post("/api/v1/supplier/points", json=point_payload, headers=headers)
    second_point = await client.post(
        "/api/v1/supplier/points",
        json={
            **point_payload,
            "name": "Test accumulator",
            "short_name": "Accumulator",
            "point_type": "accumulator",
        },
        headers=headers,
    )

    assert first_point.status_code == 201
    assert second_point.status_code == 201
    assert first_point.json()["owner_user_id"] == second_point.json()["owner_user_id"]

    async with session_factory() as session:
        stored_point = await session.get(Quarry, UUID(first_point.json()["id"]))
        assert stored_point is not None
        stored_point.moderation_status = ModerationStatus.approved.value
        await session.commit()

    edited_point = await client.patch(
        f"/api/v1/supplier/points/{first_point.json()['id']}",
        json={"name": "Updated test point"},
        headers=headers,
    )
    assert edited_point.status_code == 200
    assert edited_point.json()["name"] == "Updated test point"
    assert edited_point.json()["moderation_status"] == ModerationStatus.pending_moderation.value

    points = await client.get("/api/v1/supplier/points", headers=headers)
    assert points.status_code == 200
    assert {point["name"] for point in points.json()} == {"Updated test point", "Test accumulator"}

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


@pytest.mark.asyncio
async def test_admin_approve_returns_clear_400_for_incomplete_point(
    client,
    session_factory,
    admin_token,
):
    async with session_factory() as session:
        point = Quarry(
            name="Incomplete quarry",
            point_type="quarry",
            address="",
            lat=57.15,
            lon=65.53,
            min_delivery_price=None,
            moderation_status=ModerationStatus.pending_moderation.value,
            is_active=True,
        )
        session.add(point)
        await session.commit()
        await session.refresh(point)
        point_id = point.id

    response = await client.post(
        f"/api/v1/admin/pickup-points/{point_id}/approve",
        json={"comment": None},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 400
    assert "активный материал" in response.json()["detail"]
    assert "фотография" in response.json()["detail"]


@pytest.mark.asyncio
async def test_admin_approve_applies_quarry_defaults(
    client,
    session_factory,
    admin_token,
):
    unique = uuid4().hex
    async with session_factory() as session:
        category = Category(
            name=f"Approval category {unique}",
            slug=f"approval-category-{unique}",
            sort_order=0,
            is_active=True,
        )
        session.add(category)
        await session.flush()
        material = Material(
            category_id=category.id,
            name=f"Approval material {unique}",
            price=700,
            unit="m3",
            min_volume=1,
            is_active=True,
        )
        delivery_option = DeliveryOption(
            capacity_m3=10,
            title=f"Approval truck {unique}",
            min_price_quarry=5000,
            min_price_warehouse=3000,
            is_active=True,
            sort_order=0,
        )
        point = Quarry(
            name=f"Approval quarry {unique}",
            point_type="quarry",
            address="Test address",
            lat=57.15,
            lon=65.53,
            min_delivery_price=None,
            moderation_status=ModerationStatus.pending_moderation.value,
            is_active=True,
        )
        session.add_all([material, delivery_option, point])
        await session.flush()
        await session.execute(
            insert(quarry_materials).values(
                quarry_id=point.id,
                material_id=material.id,
                price=700,
                is_active=True,
            )
        )
        session.add(
            MediaFile(
                entity_type="quarry",
                entity_id=point.id,
                bucket="test",
                object_key=f"approval/{unique}.jpg",
                public_url=f"/test-media/{unique}.jpg",
                content_type="image/jpeg",
                file_name="quarry.jpg",
                file_size=1024,
                is_primary=True,
            )
        )
        await session.commit()
        point_id = point.id

    response = await client.post(
        f"/api/v1/admin/pickup-points/{point_id}/approve",
        json={"comment": None},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 200
    assert response.json()["moderation_status"] == ModerationStatus.approved.value
    assert response.json()["min_delivery_price"] == 5000
    assert response.json()["delivery_option_ids"]


@pytest.mark.asyncio
async def test_admin_reject_requires_reason_and_saves_it(
    client,
    session_factory,
    admin_token,
):
    async with session_factory() as session:
        point = Quarry(
            name="Rejected quarry",
            point_type="quarry",
            address="Test address",
            lat=57.15,
            lon=65.53,
            min_delivery_price=5000,
            moderation_status=ModerationStatus.pending_moderation.value,
            is_active=True,
        )
        session.add(point)
        await session.commit()
        await session.refresh(point)
        point_id = point.id

    missing_reason = await client.post(
        f"/api/v1/admin/pickup-points/{point_id}/reject",
        json={"reason": ""},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert missing_reason.status_code == 422

    response = await client.post(
        f"/api/v1/admin/pickup-points/{point_id}/reject",
        json={"reason": "Нет фотографии въезда"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 200
    assert response.json()["moderation_status"] == ModerationStatus.rejected.value
    assert response.json()["moderation_comment"] == "Нет фотографии въезда"
