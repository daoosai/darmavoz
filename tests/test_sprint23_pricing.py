from uuid import uuid4

import pytest
from sqlalchemy.dialects.postgresql import insert

import app.services.order_pricing as order_pricing
from app.models.models import (
    Category,
    City,
    DeliveryOption,
    DeliveryTariff,
    Material,
    ModerationStatus,
    Quarry,
    TransportCategory,
    quarry_materials,
)


@pytest.mark.asyncio
async def test_large_volume_uses_multiple_trips_and_multiplies_delivery_price(
    session_factory,
    monkeypatch,
):
    async with session_factory() as session:
        city = City(
            name="Тестовый город",
            region="Тестовый регион",
            code=f"s23-{uuid4().hex}",
            center_lat=57.15,
            center_lon=65.53,
            map_zoom=11,
            min_lat=56.95,
            min_lon=65.10,
            max_lat=57.45,
            max_lon=65.95,
            is_active=True,
            is_default=False,
        )
        transport_category = TransportCategory(
            slug=f"s23-large-{uuid4().hex}",
            title="Тестовая большая машина",
            capacity_min_m3=18,
            capacity_max_m3=None,
            is_active=True,
            sort_order=0,
        )
        material_category = Category(
            name="Тестовый материал",
            slug=f"s23-material-{uuid4().hex}",
            is_active=True,
            sort_order=0,
        )
        session.add_all([city, transport_category, material_category])
        await session.flush()

        material = Material(
            category_id=material_category.id,
            name="Тестовый песок",
            description="",
            price=1000,
            unit="м3",
            min_volume=1,
            is_active=True,
        )
        delivery_option = DeliveryOption(
            transport_category_id=transport_category.id,
            capacity_m3=20,
            title="Самосвал 20 м³",
            is_active=True,
            sort_order=0,
        )
        delivery_tariff = DeliveryTariff(
            city_id=city.id,
            transport_category_id=transport_category.id,
            distance_from_km=0,
            distance_to_km=None,
            rate_per_km=500,
            min_price_quarry=3000,
            min_price_warehouse=3000,
            is_active=True,
            sort_order=0,
        )
        quarry = Quarry(
            city_id=city.id,
            name="Тестовый карьер",
            address="Тестовый адрес",
            lat=57.15,
            lon=65.53,
            point_type="quarry",
            moderation_status=ModerationStatus.approved.value,
            placement_status="active",
            is_active=True,
        )
        session.add_all([material, delivery_option, delivery_tariff, quarry])
        await session.flush()
        await session.execute(
            insert(quarry_materials).values(
                quarry_id=quarry.id,
                material_id=material.id,
                price=1000,
                is_active=True,
            )
        )
        await session.commit()

        async def route_distance(*_args, **_kwargs) -> float:
            return 10.0

        monkeypatch.setattr(order_pricing, "get_2gis_route_distance", route_distance)
        pricing = await order_pricing.calculate_client_order_pricing(
            session,
            material_id=material.id,
            delivery_option_id=delivery_option.id,
            delivery_lat=57.20,
            delivery_lon=65.60,
            volume=100,
            quarry_id=quarry.id,
            city_id=city.id,
        )

    assert pricing.trip_count == 5
    assert pricing.delivery_cost_per_trip == 5000
    assert pricing.delivery_cost == 25_000


@pytest.mark.asyncio
async def test_delivery_option_category_capacity_errors_are_human_readable(
    client,
    session_factory,
    admin_token,
):
    async with session_factory() as session:
        category = TransportCategory(
            slug=f"s23-small-{uuid4().hex}",
            title="Малые машины",
            capacity_min_m3=1,
            capacity_max_m3=5,
            is_active=True,
            sort_order=0,
        )
        delivery_option = DeliveryOption(
            transport_category=category,
            capacity_m3=3,
            title="Малая машина 3 м³",
            is_active=True,
            sort_order=0,
        )
        session.add_all([category, delivery_option])
        await session.commit()
        category_id = category.id
        delivery_option_id = delivery_option.id

    headers = {"Authorization": f"Bearer {admin_token}"}
    invalid_create = await client.post(
        "/api/v1/admin/delivery-options",
        headers=headers,
        json={
            "title": "Малая машина 10 м³",
            "capacity_m3": 10,
            "transport_category_id": str(category_id),
        },
    )
    assert invalid_create.status_code == 400
    assert invalid_create.json()["detail"] == (
        "Вместимость 10 м³ выходит за пределы категории «Малые машины» "
        "(допустимо от 1 до 5 м³)."
    )

    invalid_update = await client.patch(
        f"/api/v1/admin/delivery-options/{delivery_option_id}",
        headers=headers,
        json={"capacity_m3": 0},
    )
    assert invalid_update.status_code == 400
    assert invalid_update.json()["detail"] == (
        "Вместимость 0 м³ выходит за пределы категории «Малые машины» "
        "(допустимо от 1 до 5 м³)."
    )


@pytest.mark.asyncio
async def test_overlapping_tariff_range_returns_human_readable_error(
    client,
    session_factory,
    admin_token,
):
    async with session_factory() as session:
        city = City(
            name="Город тарифов",
            region="Тестовый регион",
            code=f"s23-tariffs-{uuid4().hex}",
            center_lat=57.15,
            center_lon=65.53,
            map_zoom=11,
            min_lat=56.95,
            min_lon=65.10,
            max_lat=57.45,
            max_lon=65.95,
            is_active=True,
            is_default=False,
        )
        category = TransportCategory(
            slug=f"s23-tariff-category-{uuid4().hex}",
            title="Тестовая категория",
            capacity_min_m3=1,
            capacity_max_m3=5,
            is_active=True,
            sort_order=0,
        )
        session.add_all([city, category])
        await session.flush()
        session.add(
            DeliveryTariff(
                city_id=city.id,
                transport_category_id=category.id,
                distance_from_km=0,
                distance_to_km=None,
                rate_per_km=100,
                min_price_quarry=1000,
                min_price_warehouse=1000,
                is_active=True,
                sort_order=0,
            )
        )
        await session.commit()
        city_id = city.id
        category_id = category.id

    response = await client.post(
        f"/api/v1/admin/transport-categories/{category_id}/tariffs",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "city_id": str(city_id),
            "distance_from_km": 0,
            "distance_to_km": 10,
            "rate_per_km": 100,
            "min_price_quarry": 1000,
            "min_price_warehouse": 1000,
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "Диапазоны тарифов пересекаются с существующим диапазоном для этого города и категории."
    )
