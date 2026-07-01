import logging
from dataclasses import dataclass
from math import asin, cos, radians, sin, sqrt
from uuid import UUID

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.models import DeliveryOption, Material, Quarry

logger = logging.getLogger(__name__)


def resolve_min_delivery_price(delivery_option: DeliveryOption) -> float:
    return round(float(delivery_option.min_delivery_price or 5000.0), 2)


@dataclass(slots=True)
class ClientOrderPricing:
    material: Material
    delivery_option: DeliveryOption
    quarry: Quarry
    quantity: int
    material_cost: float
    mileage_km: float
    delivery_cost: float
    total_amount: float


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
    material = await session.get(Material, material_id)
    if material is None or not material.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material not found")
    if material.price is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Material price is not configured")

    delivery_option = await session.get(DeliveryOption, delivery_option_id)
    if delivery_option is None or not delivery_option.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery option not found")
    if delivery_option.delivery_rate_per_km is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Delivery rate is not configured")

    result = await session.execute(
        select(Quarry)
        .options(selectinload(Quarry.materials))
        .join(Quarry.materials)
        .where(Quarry.is_active.is_(True), Material.id == material_id)
        .order_by(Quarry.name.asc())
    )
    quarries = list(result.scalars().unique().all())
    if not quarries:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active quarry found for material")

    selected_quarry: Quarry | None = None
    if quarry_id is not None:
        for quarry in quarries:
            if quarry.id == quarry_id:
                selected_quarry = quarry
                break
        if selected_quarry is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quarry not found for material")
    else:
        selected_quarry = min(
            quarries,
            key=lambda quarry: get_straight_distance_km(quarry.lat, quarry.lon, delivery_lat, delivery_lon),
        )

    mileage_km = await get_2gis_route_distance(
        selected_quarry.lat,
        selected_quarry.lon,
        delivery_lat,
        delivery_lon,
    )
    rate = round(float(delivery_option.delivery_rate_per_km), 2)
    material_cost = round(float(material.price) * float(delivery_option.capacity_m3) * quantity, 2)
    delivery_cost = max(
        round(mileage_km * rate, 2),
        resolve_min_delivery_price(delivery_option),
    )
    total_amount = round(material_cost + delivery_cost, 2)

    return ClientOrderPricing(
        material=material,
        delivery_option=delivery_option,
        quarry=selected_quarry,
        quantity=quantity,
        material_cost=material_cost,
        mileage_km=mileage_km,
        delivery_cost=delivery_cost,
        total_amount=total_amount,
    )
