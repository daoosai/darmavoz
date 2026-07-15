import asyncio
import logging
from dataclasses import dataclass
from math import asin, cos, radians, sin, sqrt
from uuid import UUID

import httpx
from fastapi import HTTPException, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.models import (
    DeliveryOption,
    Material,
    MediaFile,
    ModerationStatus,
    Quarry,
    quarry_delivery_options,
    quarry_materials,
)
logger = logging.getLogger(__name__)
MARKETPLACE_POINT_TYPES = ("quarry", "accumulator", "warehouse")


def resolve_min_delivery_price(
    delivery_option: DeliveryOption,
    point_type: str,
) -> float:
    if point_type in {"accumulator", "warehouse"}:
        return round(float(delivery_option.min_price_warehouse), 2)
    return round(float(delivery_option.min_price_quarry), 2)


@dataclass(slots=True)
class ClientOrderPricing:
    material: Material
    delivery_option: DeliveryOption
    quarry: Quarry
    quantity: int
    material_unit_price: float
    minimum_delivery_price: float
    material_cost: float
    mileage_km: float
    delivery_cost: float
    total_amount: float
    primary_image_url: str | None


def get_straight_distance_km(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
    radius_km = 6371.0
    delta_lat = radians(lat_b - lat_a)
    delta_lon = radians(lon_b - lon_a)
    lat_a_rad = radians(lat_a)
    lat_b_rad = radians(lat_b)
    haversine = (
        sin(delta_lat / 2) ** 2
        + cos(lat_a_rad) * cos(lat_b_rad) * sin(delta_lon / 2) ** 2
    )
    arc = 2 * asin(sqrt(haversine))
    return radius_km * arc


async def get_2gis_route_distance(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
    fallback_km = round(get_straight_distance_km(lat_a, lon_a, lat_b, lon_b) * 1.3, 2)
    log_context = {
        "lat_a": lat_a,
        "lon_a": lon_a,
        "lat_b": lat_b,
        "lon_b": lon_b,
        "fallback_km": fallback_km,
    }
    payload = {
        "points": [
            {
                "type": "stop",
                "lon": lon_a,
                "lat": lat_a,
            },
            {
                "type": "stop",
                "lon": lon_b,
                "lat": lat_b,
            },
        ],
        "transport": "driving",
        "route_mode": "shortest",
        "traffic_mode": "disabled",
        "locale": "ru",
    }

    if not settings.TWOGIS_API_KEY:
        logger.error("2gis_distance_fallback: TWOGIS_API_KEY is not configured", extra=log_context)
        return fallback_km

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                "https://routing.api.2gis.com/routing/7.0.0/global",
                params={"key": settings.TWOGIS_API_KEY},
                json=payload,
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                },
            )
    except httpx.HTTPError:
        logger.exception("2gis_distance_fallback_request_error", extra=log_context)
        return fallback_km

    response_text = response.text
    if response.status_code != status.HTTP_200_OK:
        logger.error(
            "2GIS Routing Error: %s - %s",
            response.status_code,
            response_text,
            extra=log_context,
        )
        return fallback_km

    try:
        response_data = response.json()
        api_status = response_data.get("status")
        if api_status and api_status != "OK":
            logger.error(
                "2GIS Routing Status Error: %s - %s",
                api_status,
                response_text,
                extra=log_context,
            )
            return fallback_km

        routes = response_data.get("result")
        if not isinstance(routes, list) or not routes:
            raise ValueError("2GIS response does not contain routes")

        meters = float(routes[0]["total_distance"])
        if meters <= 0:
            raise ValueError("2GIS distance must be positive")

        return round(meters / 1000.0, 2)
    except Exception:
        logger.exception(
            "2gis_distance_fallback_parse_error",
            extra={**log_context, "response_text": response_text},
        )
        return fallback_km


async def calculate_client_order_pricing(
    session: AsyncSession,
    *,
    material_id: UUID,
    delivery_option_id: UUID,
    delivery_lat: float,
    delivery_lon: float,
    quantity: int = 1,
    quarry_id: UUID | None = None,
) -> ClientOrderPricing:
    if quarry_id is not None:
        selected_point = await session.scalar(
            select(Quarry)
            .join(quarry_materials, quarry_materials.c.quarry_id == Quarry.id)
            .where(
                Quarry.id == quarry_id,
                Quarry.is_active.is_(True),
                Quarry.moderation_status == ModerationStatus.approved.value,
                Quarry.point_type.in_(MARKETPLACE_POINT_TYPES),
                quarry_materials.c.material_id == material_id,
                quarry_materials.c.is_active.is_(True),
            )
        )
        if selected_point is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Pickup point not found for material",
            )
        selected_option_id = await session.scalar(
            select(quarry_delivery_options.c.delivery_option_id).where(
                quarry_delivery_options.c.quarry_id == quarry_id,
                quarry_delivery_options.c.delivery_option_id == delivery_option_id,
                quarry_delivery_options.c.is_active.is_(True),
            )
        )
        if selected_option_id is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="DELIVERY_OPTION_NOT_AVAILABLE_AT_POINT",
            )

    options = await calculate_client_order_options(
        session,
        material_id=material_id,
        delivery_option_id=delivery_option_id,
        delivery_lat=delivery_lat,
        delivery_lon=delivery_lon,
        quantity=quantity,
    )
    if quarry_id is None:
        return options[0]
    selected_option = next(
        (option for option in options if option.quarry.id == quarry_id),
        None,
    )
    if selected_option is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Material price is not configured for pickup point",
        )
    return selected_option


async def calculate_client_order_options(
    session: AsyncSession,
    *,
    material_id: UUID,
    delivery_option_id: UUID,
    delivery_lat: float,
    delivery_lon: float,
    quantity: int = 1,
) -> list[ClientOrderPricing]:
    material = await session.get(Material, material_id)
    if material is None or not material.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material not found")
    delivery_option = await session.get(DeliveryOption, delivery_option_id)
    if delivery_option is None or not delivery_option.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery option not found")
    if delivery_option.delivery_rate_per_km is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Delivery rate is not configured")

    primary_image = (
        select(MediaFile.public_url)
        .where(MediaFile.entity_type == "quarry", MediaFile.entity_id == Quarry.id)
        .order_by(
            MediaFile.is_primary.desc(),
            MediaFile.sort_order.asc(),
            MediaFile.created_at.asc(),
        )
        .limit(1)
        .scalar_subquery()
    )
    result = await session.execute(
        select(
            Quarry,
            quarry_materials.c.price,
            primary_image.label("primary_image_url"),
        )
        .join(quarry_materials, quarry_materials.c.quarry_id == Quarry.id)
        .join(
            quarry_delivery_options,
            and_(
                quarry_delivery_options.c.quarry_id == Quarry.id,
                quarry_delivery_options.c.delivery_option_id == delivery_option_id,
                quarry_delivery_options.c.is_active.is_(True),
            ),
        )
        .where(
            Quarry.is_active.is_(True),
            Quarry.moderation_status == ModerationStatus.approved.value,
            Quarry.point_type.in_(MARKETPLACE_POINT_TYPES),
            quarry_materials.c.material_id == material_id,
            quarry_materials.c.is_active.is_(True),
        )
        .order_by(Quarry.name.asc())
    )
    quarry_rows = list(result.unique().all())
    priced_rows = [
        (
            quarry,
            float(price if price is not None else material.price or 0),
            primary_image_url,
        )
        for quarry, price, primary_image_url in quarry_rows
        if float(price if price is not None else material.price or 0) > 0
    ]
    if not priced_rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active pickup point found for material and delivery option",
        )

    distances = await asyncio.gather(
        *(
            get_2gis_route_distance(
                quarry.lat,
                quarry.lon,
                delivery_lat,
                delivery_lon,
            )
            for quarry, _price, _primary_image_url in priced_rows
        )
    )
    rate = round(float(delivery_option.delivery_rate_per_km), 2)
    options: list[ClientOrderPricing] = []
    for (quarry, material_unit_price, primary_image_url), mileage_km in zip(
        priced_rows,
        distances,
    ):
        minimum_delivery_price = resolve_min_delivery_price(delivery_option, quarry.point_type)
        material_cost = round(
            material_unit_price * float(delivery_option.capacity_m3) * quantity,
            2,
        )
        delivery_cost = max(
            round(mileage_km * rate, 2),
            minimum_delivery_price,
        )
        options.append(
            ClientOrderPricing(
                material=material,
                delivery_option=delivery_option,
                quarry=quarry,
                quantity=quantity,
                material_unit_price=material_unit_price,
                minimum_delivery_price=minimum_delivery_price,
                material_cost=material_cost,
                mileage_km=mileage_km,
                delivery_cost=delivery_cost,
                total_amount=round(material_cost + delivery_cost, 2),
                primary_image_url=primary_image_url,
            )
        )

    options.sort(
        key=lambda option: (
            option.total_amount,
            option.mileage_km,
            option.quarry.name.casefold(),
        )
    )
    return options
