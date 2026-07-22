from math import asin, cos, isfinite, radians, sin, sqrt
from typing import Any

import logging
import httpx
from fastapi import APIRouter, HTTPException, Query, status

from app.core.config import settings


logger = logging.getLogger(__name__)
router = APIRouter()
TYUMEN_CITY_NAME = "Тюмень"
TYUMEN_LOCATION = "65.534328,57.152286"
TYUMEN_BOUND = "65.10,56.95,65.95,57.45"
GEOCODE_FALLBACK_ERROR_MESSAGE = "Не удалось рассчитать маршрут. Проверьте адрес доставки."
ROUTE_DISTANCE_FALLBACK_FACTOR = 1.3


def _extract_2gis_error(payload: dict[str, Any]) -> str | None:
    for key in ("message", "error"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    errors = payload.get("errors")
    if isinstance(errors, list):
        for item in errors:
            if isinstance(item, str) and item.strip():
                return item.strip()
            if isinstance(item, dict):
                for key in ("message", "error"):
                    value = item.get(key)
                    if isinstance(value, str) and value.strip():
                        return value.strip()
    return None


def _prepare_tyumen_address(address: str) -> str:
    normalized = address.strip()
    if TYUMEN_CITY_NAME.casefold() in normalized.casefold():
        return normalized
    return f"{TYUMEN_CITY_NAME} {normalized}"


def _parse_coordinate(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if isfinite(parsed) else None


def _get_straight_distance_km(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
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


def _build_route_distance_fallback(
    pickup_lat: float,
    pickup_lon: float,
    delivery_lat: float,
    delivery_lon: float,
) -> dict[str, Any]:
    fallback_km = round(
        _get_straight_distance_km(
            pickup_lat,
            pickup_lon,
            delivery_lat,
            delivery_lon,
        ) * ROUTE_DISTANCE_FALLBACK_FACTOR,
        2,
    )
    return {
        "distance_km": fallback_km,
        "geometry": [
            {"lat": pickup_lat, "lon": pickup_lon},
            {"lat": delivery_lat, "lon": delivery_lon},
        ],
    }


async def _fallback_geocode(address: str) -> dict[str, float]:
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "q": _prepare_tyumen_address(address),
                    "format": "jsonv2",
                    "limit": 1,
                    "addressdetails": 0,
                    "accept-language": "ru",
                },
                headers={
                    "Accept": "application/json",
                    "User-Agent": "darmavoz-test-geocoder/1.0",
                },
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=GEOCODE_FALLBACK_ERROR_MESSAGE,
        ) from exc

    try:
        items = response.json()
        if not isinstance(items, list) or not items:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=GEOCODE_FALLBACK_ERROR_MESSAGE,
            )

        lat = _parse_coordinate(items[0].get("lat"))
        lon = _parse_coordinate(items[0].get("lon"))
        if lat is None or lon is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=GEOCODE_FALLBACK_ERROR_MESSAGE,
            )

        return {"lat": lat, "lon": lon}
    except HTTPException:
        raise
    except (ValueError, TypeError, KeyError, IndexError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=GEOCODE_FALLBACK_ERROR_MESSAGE,
        ) from exc


def _parse_wkt_linestring(linestring: str) -> list[dict[str, float]]:
    if not isinstance(linestring, str):
        return []

    value = linestring.strip()
    prefix = "LINESTRING("
    if not value.startswith(prefix) or not value.endswith(")"):
        return []

    coordinates_part = value[len(prefix):-1].strip()
    if not coordinates_part:
        return []

    points: list[dict[str, float]] = []
    for raw_point in coordinates_part.split(","):
        parts = raw_point.strip().split()
        if len(parts) < 2:
            continue

        try:
            lon = float(parts[0])
            lat = float(parts[1])
        except ValueError:
            continue

        points.append({"lat": lat, "lon": lon})

    return points


def _extend_geometry(target: list[dict[str, float]], points: list[dict[str, float]]) -> None:
    for point in points:
        if target and target[-1] == point:
            continue
        target.append(point)


def _collect_route_geometry(route: dict[str, Any]) -> list[dict[str, float]]:
    geometry: list[dict[str, float]] = []

    begin_selection = route.get("begin_pedestrian_path", {}).get("geometry", {}).get("selection")
    _extend_geometry(geometry, _parse_wkt_linestring(begin_selection))

    maneuvers = route.get("maneuvers")
    if isinstance(maneuvers, list):
        for maneuver in maneuvers:
            if not isinstance(maneuver, dict):
                continue
            outcoming_path = maneuver.get("outcoming_path", {})
            segments = outcoming_path.get("geometry", [])
            if not isinstance(segments, list):
                continue
            for segment in segments:
                if not isinstance(segment, dict):
                    continue
                _extend_geometry(
                    geometry,
                    _parse_wkt_linestring(segment.get("selection", "")),
                )

    end_selection = route.get("end_pedestrian_path", {}).get("geometry", {}).get("selection")
    _extend_geometry(geometry, _parse_wkt_linestring(end_selection))

    return geometry


@router.get("/geocode")
async def geocode_address(
    address: str = Query(..., min_length=1, max_length=500),
) -> dict[str, float]:
    if not settings.TWOGIS_API_KEY:
        logger.warning("2GIS key is not configured, using fallback geocoder")
        return await _fallback_geocode(address)

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://catalog.api.2gis.com/3.0/items/geocode",
                params={
                    "q": _prepare_tyumen_address(address),
                    "fields": "items.point",
                    "location": TYUMEN_LOCATION,
                    "radius": 40000,
                    "bound": TYUMEN_BOUND,
                    "key": settings.TWOGIS_API_KEY,
                },
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("2GIS geocoder is unavailable, using fallback geocoder: %s", exc)
        return await _fallback_geocode(address)

    try:
        data = response.json()
        geocoder_error = _extract_2gis_error(data)
        if geocoder_error:
            logger.warning("2GIS geocoder returned business error, using fallback geocoder: %s", geocoder_error)
            return await _fallback_geocode(address)

        items = data["result"]["items"]
        if not items:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Address not found",
            )

        point = items[0]["point"]
        return {
            "lat": float(point["lat"]),
            "lon": float(point["lon"]),
        }
    except HTTPException:
        raise
    except (KeyError, ValueError, TypeError, IndexError) as exc:
        logger.warning("Invalid 2GIS geocoder response, using fallback geocoder: %s", exc)
        return await _fallback_geocode(address)


@router.get("/route-distance")
async def get_route_distance(
    pickup_lat: float = Query(..., ge=-90, le=90),
    pickup_lon: float = Query(..., ge=-180, le=180),
    delivery_lat: float = Query(..., ge=-90, le=90),
    delivery_lon: float = Query(..., ge=-180, le=180),
) -> dict[str, Any]:
    if not settings.TWOGIS_API_KEY:
        logger.warning("2GIS key is not configured, using fallback route distance")
        return _build_route_distance_fallback(
            pickup_lat,
            pickup_lon,
            delivery_lat,
            delivery_lon,
        )

    payload = {
        "points": [
            {
                "type": "stop",
                "lon": pickup_lon,
                "lat": pickup_lat,
            },
            {
                "type": "stop",
                "lon": delivery_lon,
                "lat": delivery_lat,
            },
        ],
        "transport": "driving",
        "route_mode": "fastest",
        "traffic_mode": "jam",
        "locale": "ru",
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                "https://routing.api.2gis.com/routing/7.0.0/global",
                params={"key": settings.TWOGIS_API_KEY},
                json=payload,
                headers={"Accept": "application/json"},
            )
    except httpx.HTTPError as exc:
        logger.warning("2GIS router is unavailable, using fallback route distance: %s", exc)
        return _build_route_distance_fallback(
            pickup_lat,
            pickup_lon,
            delivery_lat,
            delivery_lon,
        )

    if response.status_code != status.HTTP_200_OK:
        logger.error(f"2GIS Routing Error: {response.status_code} - {response.text}")
        return _build_route_distance_fallback(
            pickup_lat,
            pickup_lon,
            delivery_lat,
            delivery_lon,
        )

    try:
        data = response.json()
        if data.get("status") and data["status"] != "OK":
            router_error = _extract_2gis_error(data) or data["status"]
            logger.warning(
                "2GIS router returned business error, using fallback route distance: %s",
                router_error,
            )
            return _build_route_distance_fallback(
                pickup_lat,
                pickup_lon,
                delivery_lat,
                delivery_lon,
            )

        router_error = _extract_2gis_error(data)
        if router_error:
            logger.warning(
                "2GIS router returned business message, using fallback route distance: %s",
                router_error,
            )
            return _build_route_distance_fallback(
                pickup_lat,
                pickup_lon,
                delivery_lat,
                delivery_lon,
            )

        routes = data["result"]
        if not routes:
            logger.warning("2GIS router returned no routes, using fallback route distance")
            return _build_route_distance_fallback(
                pickup_lat,
                pickup_lon,
                delivery_lat,
                delivery_lon,
            )

        route = routes[0]
        total_distance_m = float(route["total_distance"])
        if total_distance_m <= 0:
            logger.warning("2GIS router returned non-positive distance, using fallback route distance")
            return _build_route_distance_fallback(
                pickup_lat,
                pickup_lon,
                delivery_lat,
                delivery_lon,
            )

        return {
            "distance_km": round(total_distance_m / 1000.0, 2),
            "geometry": _collect_route_geometry(route),
        }
    except (KeyError, ValueError, TypeError, IndexError) as exc:
        logger.warning("Invalid 2GIS router response, using fallback route distance: %s", exc)
        return _build_route_distance_fallback(
            pickup_lat,
            pickup_lon,
            delivery_lat,
            delivery_lon,
        )
