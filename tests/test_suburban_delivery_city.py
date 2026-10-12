from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.models import (
    Category,
    City,
    Client,
    CrmStatus,
    DeliveryOption,
    Material,
    Quarry,
    quarry_materials,
)
from app.services.cities import resolve_delivery_city
from app.services.dispatch_service import create_checkout_order
from app.services.order_pricing import calculate_client_order_options
from app.security.auth import get_current_client
from main import app


def locality(name="Патрушева", lat=57.09, lon=65.53):
    return City(
        name=name,
        code=f"suburb-{uuid4().hex}",
        region="Тест",
        center_lat=lat,
        center_lon=lon,
        map_zoom=11,
        min_lat=lat - 0.1,
        max_lat=lat + 0.1,
        min_lon=lon - 0.1,
        max_lon=lon + 0.1,
        is_active=True,
        sort_order=10000,
    )


@pytest.mark.asyncio
async def test_suburb_matching_pricing_checkout_and_address(
    client, session_factory, monkeypatch
):
    async def distance(*args, **kwargs):
        return 12.0

    monkeypatch.setattr("app.services.order_pricing.get_2gis_route_distance", distance)
    async with session_factory() as db:
        market = await db.scalar(select(City).where(City.code == "tyumen"))
        village = locality()
        category = Category(
            name="Suburb sand", slug=f"suburb-sand-{uuid4().hex}", is_active=True
        )
        customer = Client(
            name="Suburban client", phone=f"+7{uuid4().int % 10**10:010d}"
        )
        db.add_all([village, category, customer])
        await db.flush()
        material = Material(
            name="Лесной песок",
            category_id=category.id,
            price=180,
            unit="m3",
            is_active=True,
        )
        truck = DeliveryOption(
            capacity_m3=5,
            title="Suburb truck",
            delivery_rate_per_km=100,
            min_price_quarry=1000,
            min_price_warehouse=1000,
            is_active=True,
        )
        point = Quarry(
            name="Suburb quarry",
            address="No city text",
            city_id=market.id,
            lat=57.1,
            lon=66.06,
            is_active=True,
            crm_status=CrmStatus.activated.value,
            moderation_status="approved",
            placement_status="active",
        )
        db.add_all([material, truck, point])
        await db.flush()
        await db.execute(
            quarry_materials.insert().values(
                quarry_id=point.id, material_id=material.id, price=180, is_active=True
            )
        )
        await db.commit()
        lat, lon = 57.091586, 65.533642
        assert (await resolve_delivery_city(db, village.id, lat, lon)).id == market.id
        pricing = await calculate_client_order_options(
            db,
            city_id=village.id,
            material_id=material.id,
            delivery_option_id=truck.id,
            delivery_lat=lat,
            delivery_lon=lon,
        )
        assert pricing[0].quarry.id == point.id
        order = await create_checkout_order(
            db,
            client_id=customer.id,
            city_id=village.id,
            material_id=material.id,
            delivery_option_id=truck.id,
            delivery_address="Патрушева, Садовая улица, 3а",
            delivery_lat=lat,
            delivery_lon=lon,
            quarry_id=point.id,
            notes=None,
            source="client",
            quantity=1,
        )
        assert order.city_id == market.id

        async def authenticated():
            return customer

        app.dependency_overrides[get_current_client] = authenticated
        try:
            response = await client.post(
                "/api/v1/client/addresses",
                json={
                    "city_id": str(village.id),
                    "full_address": "Патрушева, Садовая улица, 3а",
                    "lat": lat,
                    "lon": lon,
                },
            )
            assert response.status_code == 201, response.text
            assert response.json()["city_id"] == str(market.id)
        finally:
            app.dependency_overrides.pop(get_current_client, None)
        markers = await client.get(
            "/api/v1/catalog/pickup-points",
            params={
                "city_id": str(village.id),
                "material_id": str(material.id),
                "lat": lat,
                "lon": lon,
            },
        )
        assert markers.status_code == 200 and str(point.id) in {
            p["id"] for p in markers.json()
        }
        detail = await client.get(
            f"/api/v1/catalog/pickup-points/{point.id}",
            params={
                "city_id": str(village.id),
                "material_id": str(material.id),
                "lat": lat,
                "lon": lon,
            },
        )
        assert detail.status_code == 200, detail.text
        result = await client.get(
            "/api/v1/cities/delivery",
            params={"city_id": str(village.id), "lat": lat, "lon": lon},
        )
        assert result.status_code == 200 and result.json()["id"] == str(market.id)
        await db.delete(village)
        await db.commit()


@pytest.mark.asyncio
async def test_far_locality_and_unrelated_delivery_coordinates_do_not_cross_markets(
    session_factory,
):
    async with session_factory() as db:
        distant = locality("Далёкое село", lat=60, lon=70)
        nearby = locality()
        db.add_all([distant, nearby])
        await db.commit()
        assert (await resolve_delivery_city(db, distant.id, 60, 70)).id == distant.id
        assert (await resolve_delivery_city(db, nearby.id, 60, 70)).id == nearby.id
        await db.delete(distant)
        await db.delete(nearby)
        await db.commit()


@pytest.mark.asyncio
async def test_configured_market_keeps_scope_when_tariffs_are_disabled(session_factory):
    from app.models.models import DeliveryTariff, TransportCategory

    async with session_factory() as db:
        city = locality("Настроенный город")
        category = await db.scalar(select(TransportCategory).limit(1))
        db.add(city)
        await db.flush()
        tariff = DeliveryTariff(
            city_id=city.id,
            transport_category_id=category.id,
            distance_from_km=0,
            rate_per_km=100,
            min_price_quarry=1000,
            min_price_warehouse=1000,
            is_active=False,
        )
        db.add(tariff)
        await db.commit()
        assert (await resolve_delivery_city(db, city.id, 57.09, 65.53)).id == city.id
        await db.delete(tariff)
        await db.delete(city)
        await db.commit()
