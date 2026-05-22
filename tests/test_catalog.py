import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_get_categories(client: AsyncClient):
    response = await client.get("/api/v1/catalog/categories/")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)

@pytest.mark.asyncio
async def test_get_materials(client: AsyncClient):
    response = await client.get("/api/v1/catalog/materials/")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
