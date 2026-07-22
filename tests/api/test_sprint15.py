import pytest


@pytest.mark.asyncio
async def test_equipment_router_is_available(client):
    response = await client.get("/api/v1/equipment")

    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.asyncio
async def test_support_router_is_available(client):
    response = await client.get("/api/v1/support")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "support"}
