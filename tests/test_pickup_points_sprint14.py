import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects.postgresql import insert

from app.models.models import (
    Category,
    DeliveryOption,
    Material,
    MediaFile,
    ModerationStatus,
    Quarry,
    quarry_delivery_options,
    quarry_materials,
)
from app.services.order_pricing import calculate_client_order_pricing


async def _catalog_entities(
    session,
    *,
    capacity: float,
    quarry_minimum: float = 5000,
    warehouse_minimum: float = 3000,
):
    category = Category(
        name=f"Category {uuid.uuid4().hex[:8]}",
        slug=f"category-{uuid.uuid4().hex}",
        sort_order=0,
        is_active=True,
    )
    session.add(category)
    await session.flush()
    material = Material(
        category_id=category.id,
        name=f"Sand {uuid.uuid4().hex[:8]}",
        price=999,
        unit="m3",
        min_volume=1,
        is_active=True,
    )
    delivery_option = DeliveryOption(
        capacity_m3=capacity,
        title=f"Truck {capacity}",
        delivery_rate_per_km=100,
        min_price_quarry=quarry_minimum,
        min_price_warehouse=warehouse_minimum,
        is_active=True,
        sort_order=0,
    )
    session.add_all([material, delivery_option])
    await session.flush()
    return material, delivery_option


async def _point_with_offer(
    session,
    *,
    material,
    delivery_option,
    point_type: str,
    point_minimum: float,
    offer_price: float,
    moderation_status: str = ModerationStatus.approved.value,
):
    point = Quarry(
        name=f"Point {uuid.uuid4().hex[:8]}",
        address="Test address",
        lat=57.15,
        lon=65.53,
        point_type=point_type,
        min_delivery_price=point_minimum,
        moderation_status=moderation_status,
        is_active=True,
    )
    session.add(point)
    await session.flush()
    await session.execute(
        insert(quarry_materials).values(
            quarry_id=point.id,
            material_id=material.id,
            price=offer_price,
            is_active=True,
        )
    )
    await session.execute(
        insert(quarry_delivery_options).values(
            quarry_id=point.id,
            delivery_option_id=delivery_option.id,
            is_active=True,
        )
    )
    await session.commit()
    return point


@pytest.mark.asyncio
async def test_public_map_returns_only_approved_configured_points(client, session_factory):
    async with session_factory() as session:
        material, delivery_option = await _catalog_entities(
            session, capacity=5
        )
        approved = await _point_with_offer(
            session,
            material=material,
            delivery_option=delivery_option,
            point_type="accumulator",
            point_minimum=3000,
            offer_price=750,
        )
        await _point_with_offer(
            session,
            material=material,
            delivery_option=delivery_option,
            point_type="accumulator",
            point_minimum=3000,
            offer_price=700,
            moderation_status=ModerationStatus.pending_moderation.value,
        )
        material_id = material.id

    response = await client.get(
        "/api/v1/catalog/pickup-points",
        params={"material_id": str(material_id)},
    )
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [str(approved.id)]
    assert response.json()[0]["price"] == 750
    assert response.json()[0]["min_delivery_price"] == 3000


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("point_type", "capacity", "point_minimum", "expected"),
    [
        ("accumulator", 5, 3000, 3000),
        ("quarry", 10, 5000, 5000),
    ],
)
async def test_point_type_minimum_and_offer_price_are_used(
    monkeypatch,
    session_factory,
    point_type,
    capacity,
    point_minimum,
    expected,
):
    async def fixed_distance(*_args):
        return 1.0

    monkeypatch.setattr("app.services.order_pricing.get_2gis_route_distance", fixed_distance)
    async with session_factory() as session:
        material, delivery_option = await _catalog_entities(
            session, capacity=capacity
        )
        point = await _point_with_offer(
            session,
            material=material,
            delivery_option=delivery_option,
            point_type=point_type,
            point_minimum=point_minimum,
            offer_price=700,
        )
        pricing = await calculate_client_order_pricing(
            session,
            material_id=material.id,
            delivery_option_id=delivery_option.id,
            delivery_lat=57.2,
            delivery_lon=65.6,
            quarry_id=point.id,
        )

    assert pricing.material_unit_price == 700
    assert pricing.material_cost == 700 * capacity
    assert pricing.delivery_cost == expected


@pytest.mark.asyncio
async def test_delivery_option_must_be_allowed_for_point(monkeypatch, session_factory):
    async def fixed_distance(*_args):
        return 1.0

    monkeypatch.setattr("app.services.order_pricing.get_2gis_route_distance", fixed_distance)
    async with session_factory() as session:
        material, small_truck = await _catalog_entities(
            session, capacity=5
        )
        large_truck = DeliveryOption(
            capacity_m3=20,
            title="Large truck",
            delivery_rate_per_km=100,
            min_price_quarry=5000,
            min_price_warehouse=3000,
            is_active=True,
            sort_order=1,
        )
        session.add(large_truck)
        await session.flush()
        point = await _point_with_offer(
            session,
            material=material,
            delivery_option=small_truck,
            point_type="accumulator",
            point_minimum=3000,
            offer_price=700,
        )

        with pytest.raises(HTTPException) as exc_info:
            await calculate_client_order_pricing(
                session,
                material_id=material.id,
                delivery_option_id=large_truck.id,
                delivery_lat=57.2,
                delivery_lon=65.6,
                quarry_id=point.id,
            )

    assert exc_info.value.detail == "DELIVERY_OPTION_NOT_AVAILABLE_AT_POINT"


@pytest.mark.asyncio
async def test_calculate_returns_best_option_and_sorted_alternatives(
    client,
    session_factory,
    monkeypatch,
):
    async def fixed_distance(lat_a, *_args):
        return 10.0 if lat_a == 57.15 else 2.0

    monkeypatch.setattr("app.services.order_pricing.get_2gis_route_distance", fixed_distance)
    async with session_factory() as session:
        material, delivery_option = await _catalog_entities(session, capacity=5)
        quarry = await _point_with_offer(
            session,
            material=material,
            delivery_option=delivery_option,
            point_type="quarry",
            point_minimum=100,
            offer_price=600,
        )
        accumulator = await _point_with_offer(
            session,
            material=material,
            delivery_option=delivery_option,
            point_type="accumulator",
            point_minimum=9000,
            offer_price=700,
        )
        accumulator.lat = 58.0
        accumulator.rating = 4.8
        session.add(
            MediaFile(
                entity_type="quarry",
                entity_id=accumulator.id,
                bucket="test-media",
                object_key=f"quarries/{accumulator.id}/primary.jpg",
                public_url="https://cdn.example/quarry.jpg",
                content_type="image/jpeg",
                file_name="primary.jpg",
                file_size=1024,
                is_primary=True,
            )
        )
        session.add(
            MediaFile(
                entity_type="quarry",
                entity_id=quarry.id,
                bucket="test-media",
                object_key=f"quarries/{quarry.id}/primary.jpg",
                public_url="https://cdn.example/alternative-quarry.jpg",
                content_type="image/jpeg",
                file_name="primary.jpg",
                file_size=1024,
                is_primary=True,
            )
        )
        await session.commit()

        material_id = material.id
        delivery_option_id = delivery_option.id
        quarry_id = quarry.id
        accumulator_id = accumulator.id

    response = await client.post(
        "/api/v1/client/orders/calculate",
        json={
            "material_id": str(material_id),
            "delivery_option_id": str(delivery_option_id),
            "delivery_lat": 57.2,
            "delivery_lon": 65.6,
            "quantity": 1,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["best_option"] == {
        "quarry_id": str(accumulator_id),
        "quarry_name": accumulator.name,
        "point_type": "accumulator",
        "rating": 4.8,
        "distance": 2.0,
        "delivery_cost": 3000.0,
        "material_cost": 3500.0,
        "total_amount": 6500.0,
        "primary_image_url": "https://cdn.example/quarry.jpg",
    }
    assert [option["quarry_id"] for option in payload["alternatives"]] == [str(quarry_id)]
    assert payload["alternatives"][0]["total_amount"] == 8000.0
    assert payload["alternatives"][0]["primary_image_url"] == "https://cdn.example/alternative-quarry.jpg"

    selected_response = await client.post(
        "/api/v1/client/orders/calculate",
        json={
            "material_id": str(material_id),
            "quarry_id": str(quarry_id),
            "delivery_option_id": str(delivery_option_id),
            "delivery_lat": 57.2,
            "delivery_lon": 65.6,
            "quantity": 1,
        },
    )

    assert selected_response.status_code == 200
    selected_payload = selected_response.json()
    assert selected_payload["best_option"]["quarry_id"] == str(quarry_id)
    assert selected_payload["best_option"]["total_amount"] == 8000.0
    assert [option["quarry_id"] for option in selected_payload["alternatives"]] == [
        str(accumulator_id)
    ]
