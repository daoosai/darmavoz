"""Archived/email owner usernames must not invalidate the pickup point response."""

from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.models import City, Quarry, Role, User


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "owner_username,point_phone,expected",
    [
        ("+79999999999_del_cd1105", "+79001234567", "+79001234567"),
        ("supplier-email-very-long@example.com", None, None),
        ("+79009999999", "+79001234567", "+79009999999"),
    ],
)
async def test_admin_points_ignore_non_phone_owner_identifiers(
    client, session_factory, admin_token, owner_username, point_phone, expected
):
    async with session_factory() as db:
        role = await db.scalar(select(Role).where(Role.name == "supplier"))
        if role is None:
            role = Role(name="supplier", description="Supplier")
            db.add(role)
            await db.flush()
        city = await db.scalar(select(City).where(City.code == "tyumen"))
        owner = User(
            username=owner_username,
            role_id=role.id,
            hashed_password="qa-unused",
            is_active="_del_" not in owner_username,
        )
        db.add(owner)
        await db.flush()
        point = Quarry(
            name=f"Contact QA {uuid4().hex}",
            address="Тест",
            city_id=city.id,
            owner_user_id=owner.id,
            contact_phone=point_phone,
            is_active=False,
            placement_status="hidden",
            moderation_status="approved",
        )
        db.add(point)
        await db.commit()
        point_id = str(point.id)
    headers = {"Authorization": f"Bearer {admin_token}"}
    for path in [
        "/api/v1/admin/pickup-points?placement_status=hidden",
        f"/api/v1/admin/pickup-points/{point_id}",
    ]:
        result = await client.get(path, headers=headers)
        assert result.status_code == 200, result.text
        value = result.json()
        point_data = (
            next(p for p in value if p["id"] == point_id)
            if isinstance(value, list)
            else value
        )
        assert point_data["contact_phone"] == expected
        assert point_data["owner_phone"] == (
            owner_username
            if owner_username.startswith("+7") and "_del_" not in owner_username
            else None
        )
