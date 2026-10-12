import uuid

import pytest
from sqlalchemy import select

from app.models.models import Category, City, CrmStatus, Material, Quarry, quarry_materials


@pytest.mark.asyncio
async def test_guest_map_location_crosses_locality_boundary_without_changing_catalog_scope(client, session_factory):
    async with session_factory() as db:
        market = await db.scalar(select(City).where(City.code == "tyumen"))
        village = City(name="Map village", region="Test", code=f"map-{uuid.uuid4().hex}",
                       center_lat=57.094663, center_lon=65.527353, map_zoom=11, min_lat=56.9, max_lat=57.4,
                       min_lon=65.1, max_lon=66.1, is_active=True)
        db.add(village)
        await db.flush()
        points = [
            Quarry(name="Nearby suburban quarry", address="Outside market bbox", lat=57.103453,
                   lon=66.066938, city_id=market.id, crm_status=CrmStatus.activated.value, is_active=True),
            Quarry(name="Nearby gray point", address="Village", lat=57.094663, lon=65.527353,
                   city_id=village.id, crm_status=CrmStatus.registration_completed.value, is_active=False),
            Quarry(name="Distant quarry", address="Other region", lat=60, lon=65.5,
                   city_id=market.id, crm_status=CrmStatus.activated.value, is_active=True),
            Quarry(name="Hidden nearby", address="Hidden", lat=57.1, lon=65.53,
                   city_id=market.id, crm_status=CrmStatus.refused.value, is_active=True),
        ]
        db.add_all(points)
        category = Category(name="Map sand", slug=f"map-sand-{uuid.uuid4().hex}", is_active=True)
        db.add(category)
        await db.flush()
        material = Material(name="Forest sand", category_id=category.id, price=180, unit="m3", is_active=True)
        db.add(material)
        await db.flush()
        await db.execute(quarry_materials.insert().values(
            quarry_id=points[0].id, material_id=material.id, price=180, is_active=True,
        ))
        await db.commit()
        village_id = str(village.id)
        ids = [str(point.id) for point in points]

    response = await client.get("/api/v1/catalog/pickup-points/global", params={
        "city_id": village_id, "lat": 57.094663, "lon": 65.527353,
    })
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store, max-age=0"
    returned = {item["id"] for item in response.json()}
    assert ids[0] in returned and ids[1] in returned
    assert ids[2] not in returned and ids[3] not in returned
    green = next(item for item in response.json() if item["id"] == ids[0])
    assert green["is_active"] is True and green["crm_status"] == "activated"
    assert green["material_offers"][0]["price"] == 180
    assert next(item for item in response.json() if item["id"] == ids[1])["is_active"] is False

    legacy = await client.get("/api/v1/catalog/pickup-points/global", params={"city_id": village_id})
    assert legacy.status_code == 200
    assert {item["id"] for item in legacy.json()} == {ids[1]}

    close = await client.get("/api/v1/catalog/pickup-points/global", params={
        "lat": 57.094663, "lon": 65.527353, "radius_km": 5,
    })
    assert ids[0] not in {item["id"] for item in close.json()}
    assert ids[1] in {item["id"] for item in close.json()}


@pytest.mark.asyncio
@pytest.mark.parametrize("params", [
    {"lat": 57}, {"lon": 65}, {"lat": 91, "lon": 65},
    {"lat": 57, "lon": 181}, {"lat": "nan", "lon": 65},
    {"lat": 57, "lon": 65, "radius_km": 0},
    {"lat": 57, "lon": 65, "radius_km": 201},
])
async def test_location_input_validation(client, params):
    response = await client.get("/api/v1/catalog/pickup-points/global", params=params)
    assert response.status_code == 422
