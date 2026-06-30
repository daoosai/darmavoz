from typing import Any

import logging
import httpx
from fastapi import APIRouter, HTTPException, Query, status

from app.core.config import settings


logger = logging.getLogger(__name__)
router = APIRouter()


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
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="TWOGIS_API_KEY is not configured",
        )

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://catalog.api.2gis.com/3.0/items/geocode",
                params={
                    "q": address,
                    "fields": "items.point",
                    "key": settings.TWOGIS_API_KEY,
                },
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="2GIS geocoder is unavailable",
        ) from exc

    try:
        data = response.json()
        geocoder_error = _extract_2gis_error(data)
        if geocoder_error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=geocoder_error,
            )

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
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Invalid response from 2GIS geocoder",
        ) from exc


@router.get("/route-distance")
async def get_route_distance(
    pickup_lat: float = Query(..., ge=-90, le=90),
    pickup_lon: float = Query(..., ge=-180, le=180),
    delivery_lat: float = Query(..., ge=-90, le=90),
    delivery_lon: float = Query(..., ge=-180, le=180),
) -> dict[str, Any]:
    if not settings.TWOGIS_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="TWOGIS_API_KEY is not configured",
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
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="2GIS router is unavailable",
        ) from exc

    if response.status_code != status.HTTP_200_OK:
        logger.error(f"2GIS Routing Error: {response.status_code} - {response.text}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="2GIS router is unavailable",
        )

    try:
        data = response.json()
        if data.get("status") and data["status"] != "OK":
            router_error = _extract_2gis_error(data) or data["status"]
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=router_error,
            )

        router_error = _extract_2gis_error(data)
        if router_error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=router_error,
            )

        routes = data["result"]
        if not routes:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Route not found",
            )

        route = routes[0]
        total_distance_m = float(route["total_distance"])
        if total_distance_m <= 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Route not found",
            )

        return {
            "distance_km": round(total_distance_m / 1000.0, 2),
            "geometry": _collect_route_geometry(route),
        }
    except HTTPException:
        raise
    except (KeyError, ValueError, TypeError, IndexError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Invalid response from 2GIS router",
        ) from exc
