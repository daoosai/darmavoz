import asyncio
import logging
from dataclasses import dataclass
from math import asin, cos, isfinite, radians, sin, sqrt
from uuid import UUID

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.models import (
    DeliveryOption,
    Material,
    MediaFile,
    ModerationStatus,
    Quarry,
    quarry_materials,
)
from app.services.pickup_points import public_pickup_point_filters

logger = logging.getLogger(__name__)
MARKETPLACE_POINT_TYPES = ("quarry", "accumulator", "warehouse", "supplier")
ROUTE_BUILD_ERROR_MESSAGE = "Не удалось построить маршрут до вашего адреса."
CALCULATION_DATA_ERROR_MESSAGE = "Не удалось рассчитать маршрут. Проверьте адрес доставки."


def resolve_min_delivery_price(
    delivery_option: DeliveryOption,
    point_type: str,
) -> float:
    if point_type in {"accumulator", "warehouse", "supplier"}:
        return round(float(delivery_option.min_price_warehouse), 2)
    return round(float(delivery_option.min_price_quarry), 2)


def has_valid_coordinates(lat: float | None, lon: float | None) -> bool:
    return (
        isinstance(lat, (float, int))
        and isinstance(lon, (float, int))
        and isfinite(float(lat))
        and isfinite(float(lon))
        and -90 <= float(lat) <= 90
        and -180 <= float(lon) <= 180
    )


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
    media_files: list[MediaFile]


async def load_pickup_point_media_files(
    session: AsyncSession,
    point_ids: list[UUID],
) -> dict[UUID, list[MediaFile]]:
    if not point_ids:
        return {}

    media_files = (
        await session.execute(
            select(MediaFile)
            .where(
                MediaFile.entity_type == "quarry",
                MediaFile.entity_id.in_(point_ids),
            )
            .order_by(
                MediaFile.entity_id.asc(),
                MediaFile.is_primary.desc(),
                MediaFile.sort_order.asc(),
                MediaFile.created_at.asc(),
            )
        )
    ).scalars().all()
    media_by_point: dict[UUID, list[MediaFile]] = {}
    for media_file in media_files:
        media_by_point.setdefault(media_file.entity_id, []).append(media_file)
    return media_by_point


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


def _resolve_route_distance_failure(*, strict: bool, fallback_km: float) -> float:
    if strict:
        logger.warning(
            "2GIS routing fallback applied for explicitly selected pickup point",
            extra={"fallback_km": fallback_km},
        )
    return fallback_km


async def get_2gis_route_distance(
    lat_a: float,
    lon_a: float,
    lat_b: float,
    lon_b: float,
    *,
    strict: bool = False,
) -> float:
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
        return _resolve_route_distance_failure(strict=strict, fallback_km=fallback_km)

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
        return _resolve_route_distance_failure(strict=strict, fallback_km=fallback_km)

    response_text = response.text
    if response.status_code != status.HTTP_200_OK:
        logger.error(
            "2GIS Routing Error: %s - %s",
            response.status_code,
            response_text,
            extra=log_context,
        )
        return _resolve_route_distance_failure(strict=strict, fallback_km=fallback_km)

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
            return _resolve_route_distance_failure(strict=strict, fallback_km=fallback_km)

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
        return _resolve_route_distance_failure(strict=strict, fallback_km=fallback_km)


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
    options = await calculate_client_order_options(
        session,
        material_id=material_id,
        delivery_option_id=delivery_option_id,
        delivery_lat=delivery_lat,
        delivery_lon=delivery_lon,
        quantity=quantity,
        quarry_id=quarry_id,
    )
    return options[0]


async def calculate_client_order_options(
    session: AsyncSession,
    *,
    material_id: UUID,
    delivery_option_id: UUID,
    delivery_lat: float,
    delivery_lon: float,
    quantity: int = 1,
    quarry_id: UUID | None = None,
) -> list[ClientOrderPricing]:
    material = await session.get(Material, material_id)
    if material is None or not material.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Материал недоступен.")
    delivery_option = await session.get(DeliveryOption, delivery_option_id)
    if delivery_option is None or not delivery_option.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Выбранный тип машины недоступен.",
        )
    if delivery_option.delivery_rate_per_km is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Для выбранного типа машины не настроен тариф доставки.",
        )
    if not has_valid_coordinates(delivery_lat, delivery_lon):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=CALCULATION_DATA_ERROR_MESSAGE,
        )
    selected_point: Quarry | None = None
    selected_point_price: float | None = None
    if quarry_id is not None:
        selected_point_row = await session.execute(
            select(Quarry, quarry_materials.c.price)
            .join(quarry_materials, quarry_materials.c.quarry_id == Quarry.id)
            .where(
                *public_pickup_point_filters(),
                Quarry.id == quarry_id,
                Quarry.point_type.in_(MARKETPLACE_POINT_TYPES),
                quarry_materials.c.material_id == material_id,
                quarry_materials.c.is_active.is_(True),
            )
        )
        selected_point_match = selected_point_row.first()
        if selected_point_match is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Выбранный карьер/накопитель временно недоступен.",
            )
        selected_point, selected_point_price = selected_point_match
        quarry_rows = [(selected_point, selected_point_price)]
    else:
        result = await session.execute(
            select(
                Quarry,
                quarry_materials.c.price,
            )
            .join(quarry_materials, quarry_materials.c.quarry_id == Quarry.id)
            .where(
                *public_pickup_point_filters(),
                Quarry.point_type == "quarry",
                quarry_materials.c.material_id == material_id,
                quarry_materials.c.is_active.is_(True),
            )
            .order_by(Quarry.name.asc())
        )
        quarry_rows = list(result.unique().all())
    media_by_point = await load_pickup_point_media_files(
        session,
        [quarry.id for quarry, _price in quarry_rows],
    )
    priced_rows = [
        (
            quarry,
            float(price if price is not None else material.price or 0),
            media_by_point.get(quarry.id, []),
        )
        for quarry, price in quarry_rows
        if (
            float(price if price is not None else material.price or 0) > 0
            and has_valid_coordinates(quarry.lat, quarry.lon)
        )
    ]
    if not priced_rows:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST
            if quarry_id is not None
            else status.HTTP_404_NOT_FOUND,
            detail=(
                CALCULATION_DATA_ERROR_MESSAGE
                if selected_point is not None
                and not has_valid_coordinates(selected_point.lat, selected_point.lon)
                else "В выбранной точке не установлена цена на этот материал."
                if quarry_id is not None
                else "Подходящие точки не найдены."
            ),
        )

    distances = await asyncio.gather(
        *(
                    get_2gis_route_distance(
                        quarry.lat,
                        quarry.lon,
                        delivery_lat,
                        delivery_lon,
                        strict=quarry_id is not None,
                    )
            for quarry, _price, _media_files in priced_rows
        )
    )
    rate = round(float(delivery_option.delivery_rate_per_km), 2)
    options: list[ClientOrderPricing] = []
    for (quarry, material_unit_price, media_files), mileage_km in zip(
        priced_rows,
        distances,
    ):
        primary_image_url = media_files[0].public_url if media_files else None
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
                media_files=media_files,
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
