import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_add_cart_item(client: AsyncClient):
    # First, get a material to add
    mat_response = await client.get("/api/v1/catalog/materials/")
    assert mat_response.status_code == 200
    materials = mat_response.json()
    if not materials:
        pytest.skip("No materials available to test cart")
    
    material_id = materials[0]["id"]
    min_volume = materials[0]["min_volume"]
    
    response = await client.post(
        "/api/v1/cart/items",
        json={"material_id": material_id, "volume": min_volume},
        headers={"session_key": "test_sess"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["material_id"] == material_id
    assert data["volume"] == min_volume
