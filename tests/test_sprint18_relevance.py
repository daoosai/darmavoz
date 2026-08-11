from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models.models import (
    Category,
    Material,
    ModerationStatus,
    PlacementStatus,
    Quarry,
    Role,
    User,
    quarry_materials,
)
from app.security.auth import get_password_hash
from app.security.jwt import create_access_token
from app.services.relevance import (
    CONFIRMATION_OVERDUE_REASON,
    confirm_relevance,
    extend_placement,
    initialize_trial,
    is_publicly_available,
    recalculate_status,
)


def auth_headers(username: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(data={'sub': username})}"}


async def create_user(session, role_name: str, username: str) -> User:
    role = await session.scalar(select(Role).where(Role.name == role_name))
    if role is None:
        role = Role(name=role_name, description=role_name)
        session.add(role)
        await session.flush()
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
async def test_trial_expiry_confirmation_grace_and_extension(session_factory):
    now = datetime(2026, 8, 2, 8, 0, tzinfo=UTC)
    async with session_factory() as session:
        admin = await create_user(session, "admin", "sprint18-admin")
        point = Quarry(
            name="Тестовый карьер",
            address="Тюмень, Карьерная 18",
            point_type="quarry",
            moderation_status=ModerationStatus.approved.value,
            placement_status=PlacementStatus.pending_moderation.value,
            is_active=False,
        )
        session.add(point)
        await session.flush()

        await initialize_trial(session, point, actor_user_id=admin.id, now=now)
        assert point.placement_status == PlacementStatus.trial.value
        assert point.trial_ends_at == now + timedelta(days=settings.PLACEMENT_TRIAL_DAYS)
        assert is_publicly_available(point, now=now + timedelta(days=1))

        await recalculate_status(session, point, now=point.trial_ends_at)
        assert point.placement_status == PlacementStatus.expired.value
        assert not point.is_active

        await extend_placement(session, point, actor_user_id=admin.id, now=point.trial_ends_at)
        assert point.placement_status == PlacementStatus.active.value
        assert point.placement_ends_at == point.trial_ends_at + timedelta(
            days=settings.PLACEMENT_EXTENSION_DAYS
        )

        confirmation_due = point.next_confirmation_at
        assert confirmation_due is not None
        await recalculate_status(session, point, now=confirmation_due)
        assert point.placement_status == PlacementStatus.confirmation_required.value
        assert is_publicly_available(point, now=confirmation_due)

        hidden_at = confirmation_due + timedelta(days=settings.PLACEMENT_CONFIRMATION_GRACE_DAYS)
        await recalculate_status(session, point, now=hidden_at)
        assert point.placement_status == PlacementStatus.hidden.value
        assert point.placement_hidden_reason == CONFIRMATION_OVERDUE_REASON

        await confirm_relevance(session, point, actor_user_id=admin.id, now=hidden_at)
        assert point.placement_status == PlacementStatus.active.value
        assert point.placement_ends_at == point.trial_ends_at + timedelta(
            days=settings.PLACEMENT_EXTENSION_DAYS
        )


@pytest.mark.asyncio
async def test_public_point_disappears_after_expiry_and_returns_after_extension(
    client, session_factory
):
    now = datetime.now(UTC)
    async with session_factory() as session:
        admin = await create_user(session, "admin", "sprint18-acceptance-admin")
        category = Category(name="Сыпучие материалы", slug="sprint18-materials", is_active=True)
        material = Material(
            category=category,
            name="Песок Sprint 18",
            description="",
            price=1000,
            unit="m3",
            min_volume=1,
            is_active=True,
        )
        point = Quarry(
            name="Карьер Sprint 18",
            address="Тюмень, Карьерная 18",
            point_type="quarry",
            lat=57.1,
            lon=65.5,
            moderation_status=ModerationStatus.approved.value,
            placement_status=PlacementStatus.expired.value,
            placement_started_at=now - timedelta(days=30),
            placement_ends_at=now - timedelta(minutes=1),
            subscription_end_date=now - timedelta(minutes=1),
            last_confirmed_at=now - timedelta(days=15),
            next_confirmation_at=now - timedelta(days=1),
            is_active=False,
        )
        session.add_all([category, material, point])
        await session.flush()
        await session.execute(
            quarry_materials.insert().values(
                quarry_id=point.id,
                material_id=material.id,
                price=1000,
                is_active=True,
            )
        )
        point.moderation_status = ModerationStatus.has_pending_changes.value
        point.pending_changes = {"name": "Карьер после продления"}
        await session.commit()
        point_id = point.id
        material_id = material.id

    hidden = await client.get(
        "/api/v1/catalog/pickup-points", params={"material_id": str(material_id)}
    )
    assert hidden.status_code == 200
    assert all(item["id"] != str(point_id) for item in hidden.json())

    extended = await client.post(
        f"/api/v1/admin/pickup-points/{point_id}/placement/extend",
        headers=auth_headers(admin.username),
    )
    assert extended.status_code == 200
    assert extended.json()["placement_status"] == PlacementStatus.active.value

    async with session_factory() as session:
        updated_point = await session.get(Quarry, point_id)
        assert updated_point is not None
        assert updated_point.name == "Карьер после продления"
        assert updated_point.moderation_status == ModerationStatus.approved.value
        assert updated_point.pending_changes is None

    visible = await client.get(
        "/api/v1/catalog/pickup-points", params={"material_id": str(material_id)}
    )
    assert visible.status_code == 200
    assert any(item["id"] == str(point_id) for item in visible.json())


@pytest.mark.asyncio
async def test_supplier_can_confirm_only_owned_point(client, session_factory):
    now = datetime.now(UTC)
    async with session_factory() as session:
        owner = await create_user(session, "supplier", "+79991818001")
        other = await create_user(session, "supplier", "+79991818002")
        point = Quarry(
            name="Накопитель владельца",
            address="Тюмень, Складская 18",
            point_type="accumulator",
            owner_user_id=owner.id,
            moderation_status=ModerationStatus.approved.value,
            placement_status=PlacementStatus.confirmation_required.value,
            placement_started_at=now - timedelta(days=30),
            placement_ends_at=now + timedelta(days=10),
            next_confirmation_at=now - timedelta(hours=1),
            is_active=True,
        )
        session.add(point)
        await session.commit()
        point_id = point.id

    forbidden = await client.post(
        f"/api/v1/supplier/points/{point_id}/confirm-relevance",
        headers=auth_headers(other.username),
    )
    assert forbidden.status_code == 404

    confirmed = await client.post(
        f"/api/v1/supplier/points/{point_id}/confirm-relevance",
        headers=auth_headers(owner.username),
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["placement_status"] == PlacementStatus.active.value


@pytest.mark.asyncio
async def test_admin_summary_counts_placement_statuses(client, session_factory):
    async with session_factory() as session:
        logist = await create_user(session, "logist", "sprint18-logist")
        session.add_all(
            [
                Quarry(
                    name="Активный карьер",
                    address="Адрес 1",
                    point_type="quarry",
                    moderation_status=ModerationStatus.approved.value,
                    placement_status=PlacementStatus.active.value,
                    is_active=True,
                ),
                Quarry(
                    name="Накопитель на проверке",
                    address="Адрес 2",
                    point_type="accumulator",
                    moderation_status=ModerationStatus.approved.value,
                    placement_status=PlacementStatus.confirmation_required.value,
                    is_active=True,
                ),
            ]
        )
        await session.commit()

    response = await client.get(
        "/api/v1/admin/placements/summary", headers=auth_headers(logist.username)
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["active_quarries"] >= 1
    assert payload["totals"]["confirmation_required"] >= 1
    assert payload["policy"]["extension_days"] == settings.PLACEMENT_EXTENSION_DAYS
