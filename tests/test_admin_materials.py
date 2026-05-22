import pytest
from httpx import AsyncClient
from app.models.models import Category
import uuid

pytestmark = pytest.mark.asyncio

async def test_admin_get_materials_requires_auth(client: AsyncClient):
    response = await client.get("/api/v1/admin/materials/")
    assert response.status_code == 401

async def test_admin_create_material(client: AsyncClient, admin_token: str, session_factory):
    # Create category
    async with session_factory() as session:
        category = Category(name="Test Cat", slug=f"cat_{uuid.uuid4().hex[:8]}")
        session.add(category)
        await session.commit()
        await session.refresh(category)
        cat_id = str(category.id)

    payload = {
        "name": "New Admin Material",
        "unit": "м3",
        "price": 1200.0,
        "min_volume": 1.0,
        "category_id": cat_id,
        "is_active": True
    }
    
    response = await client.post(
        "/api/v1/admin/materials/",
        json=payload,
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "New Admin Material"
    assert data["price"] == 1200.0

async def test_admin_patch_material(client: AsyncClient, admin_token: str, session_factory):
    # Create category
    async with session_factory() as session:
        category = Category(name="Test Cat", slug=f"cat_{uuid.uuid4().hex[:8]}")
        session.add(category)
        await session.commit()
        await session.refresh(category)
        cat_id = str(category.id)

    payload = {
        "name": "Admin Material 2",
        "unit": "м3",
        "category_id": cat_id
    }
    
    create_response = await client.post(
        "/api/v1/admin/materials/",
        json=payload,
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    mat_id = create_response.json()["id"]

    patch_payload = {
        "is_active": False,
        "price": 5000.0
    }
    
    patch_response = await client.patch(
        f"/api/v1/admin/materials/{mat_id}",
        json=patch_payload,
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    assert patch_response.status_code == 200
    data = patch_response.json()
    assert data["is_active"] is False
    assert data["price"] == 5000.0