from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models.models import (
    ModerationStatus,
    PlacementStatus,
    Role,
    SpecialEquipmentListing,
    SpecialEquipmentType,
    User,
)
from app.security.auth import get_password_hash
from app.security.jwt import create_access_token


def auth_headers(username: str) -> dict[str, str]:
    token = create_access_token(data={"sub": username})
    return {"Authorization": f"Bearer {token}"}


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
        hashed_password=get_password_hash("secret"),
        role_id=role.id,
        is_active=True,
    )
    session.add(user)
    await session.flush()
    return user


@pytest.mark.asyncio
async def test_admin_can_reactivate_equipment_listing_by_manual_end_date(client, session_factory):
    now = datetime.now(UTC)
    async with session_factory() as session:
        logist_role = await ensure_role(session, "logist")
        logist = await create_user(
            session,
            username="equipment_patch_logist",
            role=logist_role,
        )
        equipment_type = SpecialEquipmentType(
            name="Автокран",
            slug="avtokran-admin-test",
            is_active=True,
            sort_order=10,
        )
        listing = SpecialEquipmentListing(
            equipment_type="Автокран",
            equipment_type_ref=equipment_type,
            title="Просроченный автокран",
            description="Тестовое объявление",
            tariffs=[{"type": "hour", "price": 5000, "hours": None}],
            price_from=5000,
            moderation_status=ModerationStatus.approved.value,
            placement_status=PlacementStatus.expired.value,
            placement_started_at=now - timedelta(days=30),
            placement_ends_at=now - timedelta(days=1),
            next_confirmation_at=now - timedelta(days=1),
            last_confirmed_at=now - timedelta(days=10),
            is_active=False,
            is_deleted=False,
            created_by_user_id=logist.id,
        )
        session.add_all([equipment_type, listing])
        await session.commit()
        await session.refresh(listing)
        listing_id = listing.id

    new_end_date = (datetime.now(UTC) + timedelta(days=14)).date().isoformat()
    response = await client.patch(
        f"/api/v1/admin/equipment/{listing_id}",
        headers=auth_headers("equipment_patch_logist"),
        json={"placement_ends_at": new_end_date},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["placement_status"] == PlacementStatus.active.value
    assert payload["placement_ends_at"] is not None

    async with session_factory() as session:
        updated_listing = await session.get(SpecialEquipmentListing, listing_id)

    assert updated_listing is not None
    assert updated_listing.is_active is True
    assert updated_listing.placement_status == PlacementStatus.active.value
    assert updated_listing.placement_ends_at is not None
    assert updated_listing.placement_ends_at > datetime.now(UTC)
