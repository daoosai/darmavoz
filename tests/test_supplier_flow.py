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
from app.services.notifications import schedule_pickup_point_moderation_notification


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
        "lat": None,
        "lon": None,
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
    minimal_point = await client.post(
        "/api/v1/supplier/points",
        json={
            "name": "Minimal point",
            "short_name": "Minimal point",
            "point_type": "quarry",
            "address": "Minimal address",
            "description": None,
            "material_ids": None,
            "material_offers": None,
            "delivery_option_ids": None,
        },
        headers=headers,
    )
    assert first_point.status_code == 201
    assert second_point.status_code == 201
    assert minimal_point.status_code == 201
    assert first_point.json()["lat"] is None
    assert first_point.json()["lon"] is None
    assert minimal_point.json()["lat"] is None
    assert minimal_point.json()["lon"] is None
    assert {
        first_point.json()["owner_user_id"],
        second_point.json()["owner_user_id"],
        minimal_point.json()["owner_user_id"],
    } == {first_point.json()["owner_user_id"]}

    warehouse_point = await client.post(
        "/api/v1/supplier/points",
        json={
            **point_payload,
            "name": "Test warehouse",
            "short_name": "Warehouse",
            "point_type": "warehouse",
        },
        headers=headers,
    )
    supplier_point = await client.post(
        "/api/v1/supplier/points",
        json={
            **point_payload,
            "name": "Test supplier",
            "short_name": "Supplier",
            "point_type": "supplier",
        },
        headers=headers,
    )

    assert warehouse_point.status_code == 422
    assert supplier_point.status_code == 422

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
    assert edited_point.json()["name"] == "Test point"
    assert edited_point.json()["moderation_status"] == ModerationStatus.has_pending_changes.value
    assert edited_point.json()["pending_changes"]["name"] == "Updated test point"

    points = await client.get("/api/v1/supplier/points", headers=headers)
    assert points.status_code == 200
    assert {point["name"] for point in points.json()} == {
        "Test point",
        "Test accumulator",
        "Minimal point",
    }

    async with session_factory() as session:
        primary_media = MediaFile(
            entity_type="quarry",
            entity_id=UUID(first_point.json()["id"]),
            bucket="test-media",
            object_key=f"supplier/{uuid4().hex}-primary.jpg",
            public_url="https://cdn.example/supplier-primary.jpg",
            content_type="image/jpeg",
            file_name="primary.jpg",
            file_size=1024,
            is_primary=True,
        )
        secondary_media = MediaFile(
            entity_type="quarry",
            entity_id=UUID(first_point.json()["id"]),
            bucket="test-media",
            object_key=f"supplier/{uuid4().hex}-secondary.jpg",
            public_url="https://cdn.example/supplier-secondary.jpg",
            content_type="image/jpeg",
            file_name="secondary.jpg",
            file_size=1024,
            is_primary=False,
        )
        session.add_all([primary_media, secondary_media])
        await session.commit()
        primary_media_id = primary_media.id
        secondary_media_id = secondary_media.id

    make_primary = await client.post(
        f"/api/v1/media/{secondary_media_id}/make-primary",
        headers=headers,
    )
    assert make_primary.status_code == 200

    async with session_factory() as session:
        stored_primary = await session.get(MediaFile, primary_media_id)
        stored_secondary = await session.get(MediaFile, secondary_media_id)
        assert stored_primary is not None and stored_primary.is_primary is False
        assert stored_secondary is not None and stored_secondary.is_primary is True

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
async def test_supplier_can_submit_pending_point_without_coords_but_admin_cannot_approve_it(
    client,
    session_factory,
    monkeypatch,
    admin_token,
):
    fake_redis = FakeRedis()

    async def fake_send_sms(**_kwargs) -> str:
        return "0000"

    monkeypatch.setattr("app.api.supplier_auth.get_redis", lambda: fake_redis)
    monkeypatch.setattr("app.api.supplier_auth.send_auth_sms_code", fake_send_sms)

    challenge = await client.post(
        "/api/v1/auth/supplier/register",
        json={"phone": "+7 (999) 555-01-11"},
    )
    assert challenge.status_code == 202

    verification = await client.post(
        "/api/v1/auth/supplier/register/verify",
        json={"phone": "+79995550111", "code": "0000"},
    )
    assert verification.status_code == 200

    headers = {"Authorization": f"Bearer {verification.json()['access_token']}"}
    profile = await client.patch(
        "/api/v1/supplier/me",
        json={"display_name": "Supplier Without Coords"},
        headers=headers,
    )
    assert profile.status_code == 200

    async with session_factory() as session:
        category = Category(
            name="Инертные",
            slug=f"inert-{uuid4().hex[:8]}",
            sort_order=0,
            is_active=True,
        )
        material = Material(
            category=category,
            name="Песок карьерный",
            description=None,
            price=1800,
            unit="м3",
            min_volume=1,
            is_active=True,
            sort_order=0,
        )
        session.add_all([category, material])
        await session.commit()
        await session.refresh(material)
        material_id = material.id

    created = await client.post(
        "/api/v1/supplier/points",
        json={
            "name": "Pending quarry",
            "short_name": "Pending quarry",
            "point_type": "quarry",
            "address": "Tyumen",
            "description": "Point without coordinates",
            "lat": None,
            "lon": None,
            "materials": [
                {
                    "material_id": str(material_id),
                    "price": 1950,
                }
            ],
        },
        headers=headers,
    )
    assert created.status_code == 201
    point_id = created.json()["id"]
    assert created.json()["material_offers"]
    assert created.json()["material_offers"][0]["material_id"] == str(material_id)

    async with session_factory() as session:
        session.add(
            MediaFile(
                entity_type="quarry",
                entity_id=UUID(point_id),
                bucket="test-media",
                object_key=f"supplier/{uuid4().hex}-primary.jpg",
                public_url="https://cdn.example/pending-quarry-primary.jpg",
                content_type="image/jpeg",
                file_name="primary.jpg",
                file_size=1024,
                is_primary=True,
            )
        )
        await session.commit()

    submit = await client.post(
        f"/api/v1/supplier/points/{point_id}/submit",
        headers=headers,
    )
    assert submit.status_code == 200
    assert submit.json()["moderation_status"] == ModerationStatus.pending_moderation.value
    assert submit.json()["lat"] is None
    assert submit.json()["lon"] is None

    approve = await client.post(
        f"/api/v1/admin/pickup-points/{point_id}/approve",
        json={"comment": None},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert approve.status_code == 400
    assert "координаты" in approve.json()["detail"]


def test_pickup_point_moderation_notification_uses_point_specific_body(monkeypatch):
    scheduled: dict[str, object] = {}

    def fake_safe_schedule(func, title, body, data):
        scheduled["func"] = func
        scheduled["title"] = title
        scheduled["body"] = body
        scheduled["data"] = data

    monkeypatch.setattr("app.services.notifications._safe_schedule", fake_safe_schedule)

    point = Quarry(
        name="Северный",
        address="Тюмень",
        point_type="quarry",
        owner_user_id=uuid4(),
    )

    schedule_pickup_point_moderation_notification(point)

    assert scheduled["title"] == "Новая заявка на модерацию"
    assert scheduled["body"] == 'Поставщик добавил новый Карьер "Северный" и ожидает проверки.'
    assert scheduled["data"] == {
        "event": "pickup_point_pending_moderation",
        "pickup_point_id": str(point.id),
    }


@pytest.mark.asyncio
async def test_admin_cannot_activate_incomplete_pickup_point(
    client,
    session_factory,
    admin_token,
):
    async with session_factory() as session:
        point = Quarry(
            name="Inactive incomplete quarry",
            point_type="quarry",
            address="Test address",
            lat=57.15,
            lon=65.53,
            min_delivery_price=5000,
            moderation_status=ModerationStatus.incomplete.value,
            is_active=False,
        )
        session.add(point)
        await session.commit()
        await session.refresh(point)
        point_id = point.id

    response = await client.patch(
        f"/api/v1/admin/pickup-points/{point_id}",
        json={"is_active": True},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Невозможно активировать точку: отсутствуют материалы, цены или фото"
    )

    async with session_factory() as session:
        stored_point = await session.get(Quarry, point_id)
        assert stored_point is not None
        assert stored_point.is_active is False


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
