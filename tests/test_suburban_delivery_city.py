from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.models import (
    Category,
    City,
    Client,
    CrmStatus,
    DeliveryOption,
    DeliveryTariff,
    Material,
    Quarry,
    TransportCategory,
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


async def seed_reference_tariffs(db, market):
    rows = list(
        (
            await db.scalars(
                select(DeliveryTariff).where(DeliveryTariff.city_id == market.id)
            )
        ).all()
    )
    if not rows:
        category = await db.scalar(select(TransportCategory).limit(1))
        tariff = DeliveryTariff(
            city_id=market.id,
            transport_category_id=category.id,
            distance_from_km=0,
            rate_per_km=200,
            min_price_quarry=5000,
            min_price_warehouse=3000,
            is_active=True,
        )
        db.add(tariff)
        await db.flush()
        rows = [tariff]
    return rows


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
        # Reproduce production: Sprint 23 also seeded default tariffs for the suburb.
        root_tariffs = await seed_reference_tariffs(db, market)
        inherited_tariffs = [
            DeliveryTariff(
                city_id=village.id,
                **{
                    key: getattr(t, key)
                    for key in (
                        "transport_category_id",
                        "distance_from_km",
                        "distance_to_km",
                        "rate_per_km",
                        "min_price_quarry",
                        "min_price_warehouse",
                        "is_active",
                        "sort_order",
                    )
                },
            )
            for t in root_tariffs
        ]
        db.add_all(inherited_tariffs)
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
        for tariff in inherited_tariffs:
            await db.delete(tariff)
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


@pytest.mark.asyncio
async def test_seeded_inheritance_survives_parent_price_edit_but_custom_tariff_keeps_scope(
    session_factory,
):
    async with session_factory() as db:
        root = await db.scalar(select(City).where(City.code == "tyumen"))
        tariffs = await seed_reference_tariffs(db, root)
        suburb, custom = locality(), locality("Собственный тариф")
        db.add_all([suburb, custom])
        await db.flush()
        fields = (
            "transport_category_id",
            "distance_from_km",
            "distance_to_km",
            "rate_per_km",
            "min_price_quarry",
            "min_price_warehouse",
            "is_active",
            "sort_order",
        )
        seeded = [
            DeliveryTariff(
                city_id=suburb.id,
                created_at=t.created_at,
                updated_at=t.created_at,
                **{key: getattr(t, key) for key in fields},
            )
            for t in tariffs
        ]
        custom_tariff = DeliveryTariff(
            city_id=custom.id, **{key: getattr(tariffs[0], key) for key in fields}
        )
        custom_tariff.rate_per_km += 7
        db.add_all([*seeded, custom_tariff])
        old_rate = tariffs[0].rate_per_km
        tariffs[0].rate_per_km += 11
        await db.commit()
        assert (await resolve_delivery_city(db, suburb.id, 57.09, 65.53)).id == root.id
        assert (
            await resolve_delivery_city(db, custom.id, 57.09, 65.53)
        ).id == custom.id
        tariffs[0].rate_per_km = old_rate
        for tariff in [*seeded, custom_tariff]:
            await db.delete(tariff)
        await db.delete(suburb)
        await db.delete(custom)
        await db.commit()


@pytest.mark.asyncio
async def test_hidden_nearby_inventory_does_not_redirect_suburb(session_factory):
    async with session_factory() as db:
        root = await db.scalar(select(City).where(City.code == "tyumen"))
        suburb = locality()
        inactive_market = locality(
            "Ближайший скрытый рынок", lat=57.091586, lon=65.533642
        )
        material = await db.scalar(
            select(Material).where(Material.is_active.is_(True)).limit(1)
        )
        db.add_all([suburb, inactive_market])
        await db.flush()
        point = Quarry(
            name="Hidden nearby inventory",
            address="Test",
            city_id=inactive_market.id,
            lat=57.091586,
            lon=65.533642,
            is_active=False,
            crm_status=CrmStatus.activated.value,
            moderation_status="approved",
            placement_status="hidden",
        )
        db.add(point)
        await db.flush()
        await db.execute(
            quarry_materials.insert().values(
                quarry_id=point.id, material_id=material.id, price=180, is_active=True
            )
        )
        await db.commit()
        assert (
            await resolve_delivery_city(db, suburb.id, 57.091586, 65.533642)
        ).id == root.id
        # Existing own inventory retains its city even while temporarily hidden.
        assert (
            await resolve_delivery_city(db, inactive_market.id, 57.091586, 65.533642)
        ).id == inactive_market.id
        await db.execute(
            quarry_materials.delete().where(quarry_materials.c.quarry_id == point.id)
        )
        await db.delete(point)
        await db.flush()
        await db.delete(suburb)
        await db.delete(inactive_market)
        await db.commit()
