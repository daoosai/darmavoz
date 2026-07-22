from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.models.models import Category, Material, ModerationStatus, Quarry, Role, User
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
async def test_admin_can_patch_quarry_with_date_and_material_offers(client, session_factory):
    async with session_factory() as session:
        logist_role = await ensure_role(session, "logist")
        await create_user(session, username="quarry_patch_logist", role=logist_role)

        category = Category(
            name="Quarry Patch Category",
            slug="quarry-patch-category",
            sort_order=0,
            is_active=True,
        )
        material = Material(
            category=category,
            name="Patch Material",
            description="",
            price=2500.0,
            unit="m3",
            min_volume=1.0,
            is_active=True,
            sort_order=0,
        )
        quarry = Quarry(
            name="Patch Quarry",
            short_name="Patch Quarry",
            point_type="quarry",
            address="Tyumen, Test street, 1",
            description="Initial description",
            contact_phone=None,
            lat=57.15,
            lon=65.53,
            min_delivery_price=5000.0,
            moderation_status=ModerationStatus.incomplete.value,
            is_active=False,
        )
        session.add_all([category, material, quarry])
        await session.commit()
        await session.refresh(material)
        await session.refresh(quarry)
        material_id = material.id
        quarry_id = quarry.id

    subscription_end_date = (date.today() + timedelta(days=30)).isoformat()
    response = await client.patch(
        f"/api/v1/admin/quarries/{quarry_id}",
        headers=auth_headers("quarry_patch_logist"),
        json={
            "name": "Patch Quarry Updated",
            "address": "Tyumen, Updated street, 2",
            "description": "Updated description",
            "contact_phone": "",
            "subscription_end_date": subscription_end_date,
            "material_ids": [str(material_id)],
            "material_offers": [
                {
                    "material_id": str(material_id),
                    "price": 3200,
                    "is_active": True,
                }
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "Patch Quarry Updated"
    assert payload["contact_phone"] is None
    assert payload["subscription_end_date"] is not None
    assert payload["material_offers"]
    assert payload["material_offers"][0]["material_id"] == str(material_id)

    async with session_factory() as session:
        updated_quarry = await session.get(Quarry, quarry_id)

    assert updated_quarry is not None
    assert updated_quarry.subscription_end_date is not None
