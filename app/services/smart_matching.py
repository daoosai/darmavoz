"""Deterministic driver ranking for dispatch and logist recommendations."""

import asyncio
import json
import logging
import math
from datetime import UTC, datetime, timedelta
from typing import Iterable
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.models import Driver, Order, OrderDistributionHistory, OrderOffer, OrderOfferStatus, Vehicle
from app.services.redis_client import get_redis

logger = logging.getLogger(__name__)

ALGORITHM_VERSION = "sprint-21-v1"
LOCATION_KEY_PREFIX = "driver:location:"
ROUTE_CACHE_PREFIX = "smart-matching:truck-route:"


def utcnow() -> datetime:
    return datetime.now(UTC)


def haversine_km(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
    """Great-circle distance in kilometres, rounded only at the API boundary."""
    radius_km = 6371.0088
    lat_delta = math.radians(lat_b - lat_a)
    lon_delta = math.radians(lon_b - lon_a)
    a = (
        math.sin(lat_delta / 2) ** 2
        + math.cos(math.radians(lat_a))
        * math.cos(math.radians(lat_b))
        * math.sin(lon_delta / 2) ** 2
    )
    return radius_km * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def normalize_inverse(values: list[float]) -> list[float]:
    """Turns a lower-is-better range into [0, 1] without unstable division."""
    if not values:
        return []
    low, high = min(values), max(values)
    if math.isclose(low, high):
        return [1.0] * len(values)
    return [(high - value) / (high - low) for value in values]


def _normalise_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _requested_volume(order: Order) -> float | None:
    volume = sum(float(item.volume or 0) * int(item.quantity or 1) for item in order.items)
    return volume if volume > 0 else None


def _vehicle_matches_volume(vehicle: Vehicle | None, requested_volume: float | None) -> bool:
    if vehicle is None or requested_volume is None:
        return vehicle is not None
    if vehicle.cubature_min is not None and requested_volume < vehicle.cubature_min:
        return False
    if vehicle.cubature_max is not None and requested_volume > vehicle.cubature_max:
        return False
    if vehicle.body_volume_m3 is not None and requested_volume > vehicle.body_volume_m3:
        return False
    return True


async def _load_locations(driver_ids: list[UUID]) -> dict[UUID, tuple[float, float, datetime, str]]:
    """Read locations in one Redis request; DB fallback is added by the caller."""
    if not driver_ids:
        return {}
    try:
        values = await get_redis().mget([f"{LOCATION_KEY_PREFIX}{driver_id}" for driver_id in driver_ids])
    except Exception:
        logger.warning("smart_matching_redis_location_read_failed")
        return {}
    locations: dict[UUID, tuple[float, float, datetime, str]] = {}
    for driver_id, raw in zip(driver_ids, values, strict=True):
        if not raw:
            continue
        try:
            data = json.loads(raw)
            updated_at = _normalise_datetime(datetime.fromisoformat(data["updated_at"]))
            if updated_at is not None:
                locations[driver_id] = (float(data["lat"]), float(data["lon"]), updated_at, "redis")
        except (TypeError, ValueError, KeyError):
            logger.warning("smart_matching_redis_location_invalid", extra={"driver_id": str(driver_id)})
    return locations


def _route_cache_key(points: tuple[float, float, float, float, float, float]) -> str:
    return ROUTE_CACHE_PREFIX + ":".join(f"{point:.6f}" for point in points)


def _route_points(driver_lat: float, driver_lon: float, pickup_lat: float, pickup_lon: float, delivery_lat: float, delivery_lon: float) -> list[dict[str, float | str]]:
    return [
        {"type": "walking", "x": driver_lon, "y": driver_lat},
        {"type": "walking", "x": pickup_lon, "y": pickup_lat},
        {"type": "walking", "x": delivery_lon, "y": delivery_lat},
    ]


async def _truck_route_distance_km(
    driver_lat: float,
    driver_lon: float,
    pickup_lat: float,
    pickup_lon: float,
    delivery_lat: float,
    delivery_lon: float,
) -> tuple[float | None, str]:
    """Get a cached three-point truck route. Failures deliberately stay non-fatal."""
    cache_key = _route_cache_key((driver_lat, driver_lon, pickup_lat, pickup_lon, delivery_lat, delivery_lon))
    try:
        cached = await get_redis().get(cache_key)
        if cached:
            data = json.loads(cached)
            distance = float(data["distance_km"])
            if distance > 0:
                return distance, "cache_hit"
    except Exception:
        logger.warning("smart_matching_route_cache_read_failed", extra={"cache_key": cache_key})

    if not settings.TWOGIS_API_KEY or not settings.TWOGIS_TRUCK_DIRECTIONS_BASE_URL:
        return None, "not_configured"

    payload = {
        "points": _route_points(driver_lat, driver_lon, pickup_lat, pickup_lon, delivery_lat, delivery_lon),
        "type": "truck_jam",
        "output": "summary",
        "locale": "ru",
    }
    try:
        async with httpx.AsyncClient(timeout=settings.TWOGIS_TRUCK_DIRECTIONS_TIMEOUT_SECONDS) as client:
            response = await client.post(
                settings.TWOGIS_TRUCK_DIRECTIONS_BASE_URL,
                params={"key": settings.TWOGIS_API_KEY},
                json=payload,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
        if response.status_code == 429:
            return None, "rate_limited"
        response.raise_for_status()
        data = response.json()
        routes = data.get("result") if isinstance(data, dict) else None
        if isinstance(routes, dict):
            routes = routes.get("routes") or routes.get("items")
        route = routes[0] if isinstance(routes, list) and routes else None
        if not isinstance(route, dict):
            return None, "invalid_response"
        meters = route.get("length") or route.get("total_distance")
        distance_km = float(meters) / 1000.0
        if distance_km <= 0:
            return None, "invalid_response"
    except (httpx.HTTPError, TypeError, ValueError, KeyError):
        logger.warning("smart_matching_truck_route_failed", exc_info=True)
        return None, "provider_error"

    try:
        await get_redis().set(
            cache_key,
            json.dumps({"distance_km": round(distance_km, 3)}, separators=(",", ":")),
            ex=settings.TWOGIS_TRUCK_DIRECTIONS_CACHE_TTL_SECONDS,
        )
    except Exception:
        logger.warning("smart_matching_route_cache_write_failed", extra={"cache_key": cache_key})
    return distance_km, "ok"


class SmartMatchingService:
    """Ranks candidates while retaining enough context for audit and manual selection."""

    async def calculate(
        self,
        session: AsyncSession,
        order: Order,
        *,
        trigger_source: str,
        persist: bool = True,
        selected_driver_id: UUID | None = None,
        exclude_attempted_drivers: bool = True,
        excluded_driver_ids: set[UUID] | None = None,
        allow_penalty_fallback: bool = False,
    ) -> dict:
        excluded_driver_ids = excluded_driver_ids or set()
        query = (
            select(Driver)
            .options(selectinload(Driver.vehicle).selectinload(Vehicle.delivery_option))
            .where(Driver.vehicle_id.is_not(None))
            .order_by(Driver.dispatch_priority.desc(), Driver.id.asc())
        )
        all_drivers = list((await session.scalars(query)).all())
        attempted_ids, rejected_ids = await self._cycle_offer_ids(session, order)
        requested_volume = _requested_volume(order)
        now = utcnow()
        locations = await _load_locations([driver.id for driver in all_drivers])
        candidates: list[dict] = []
        not_recommended: list[dict] = []
        coords = (order.pickup_lat, order.pickup_lon, order.delivery_lat, order.delivery_lon)
        has_order_coordinates = all(value is not None for value in coords)

        for driver in all_drivers:
            exclusion_reasons = self._hard_exclusion_reasons(
                driver,
                requested_volume,
                attempted_ids=attempted_ids,
                rejected_ids=rejected_ids,
                excluded_driver_ids=excluded_driver_ids,
                exclude_attempted_drivers=exclude_attempted_drivers,
                allow_penalty_fallback=allow_penalty_fallback,
                now=now,
            )
            location = locations.get(driver.id)
            if location is None and driver.last_lat is not None and driver.last_lon is not None:
                updated_at = _normalise_datetime(driver.last_location_updated_at)
                if updated_at is not None:
                    location = (driver.last_lat, driver.last_lon, updated_at, "database")
            if location is None:
                exclusion_reasons.append("location_missing")
            elif location[2] < now - timedelta(seconds=settings.DRIVER_LOCATION_TTL_SECONDS):
                exclusion_reasons.append("location_stale")
            if not has_order_coordinates:
                exclusion_reasons.append("order_coordinates_missing")

            row = self._base_row(driver, exclusion_reasons)
            if exclusion_reasons:
                not_recommended.append(row)
                continue
            assert location is not None
            row["location_lat"] = location[0]
            row["location_lon"] = location[1]
            pickup_lat, pickup_lon, delivery_lat, delivery_lon = (float(value) for value in coords)
            driver_to_pickup = haversine_km(location[0], location[1], pickup_lat, pickup_lon)
            pickup_to_client = haversine_km(pickup_lat, pickup_lon, delivery_lat, delivery_lon)
            row.update(
                {
                    "driver_to_pickup_km": driver_to_pickup,
                    "pickup_to_client_km": pickup_to_client,
                    "total_distance_km": driver_to_pickup + pickup_to_client,
                    "distance_source": "haversine",
                    "distance_accuracy": "preliminary",
                    "location_source": location[3],
                }
            )
            candidates.append(row)

        twogis_status = "not_requested"
        if candidates:
            self._apply_scores(candidates)
            top_n = sorted(candidates, key=self._sort_key)[: settings.TWOGIS_TRUCK_DIRECTIONS_TOP_N]
            route_results = await asyncio.gather(
                *[
                    _truck_route_distance_km(
                        float(row["location_lat"]), float(row["location_lon"]),
                        float(order.pickup_lat), float(order.pickup_lon),
                        float(order.delivery_lat), float(order.delivery_lon),
                    )
                    for row in top_n
                ]
            )
            statuses: list[str] = []
            for row, (truck_distance, route_status) in zip(top_n, route_results, strict=True):
                statuses.append(route_status)
                if truck_distance is not None:
                    row["total_distance_km"] = truck_distance
                    row["distance_source"] = "2gis_truck"
                    row["distance_accuracy"] = "exact"
            twogis_status = "ok" if any(status in {"ok", "cache_hit"} for status in statuses) else statuses[0]
            self._apply_scores(candidates)
            candidates.sort(key=self._sort_key)
            for position, row in enumerate(candidates, start=1):
                row["position"] = position

        snapshot = {
            "order_id": str(order.id),
            "calculated_at": now.isoformat(),
            "trigger_source": trigger_source,
            "algorithm_version": ALGORITHM_VERSION,
            "recommended_driver_id": str(candidates[0]["driver_id"]) if candidates else None,
            "selected_driver_id": str(selected_driver_id) if selected_driver_id else None,
            "distance_source": "2gis_truck" if any(row["distance_source"] == "2gis_truck" for row in candidates) else "haversine",
            "twogis_status": twogis_status,
            "message": None if has_order_coordinates else "Для умного подбора нужны координаты точки забора и клиента.",
            "candidates": candidates,
            "not_recommended": not_recommended,
        }
        if persist:
            session.add(
                OrderDistributionHistory(
                    order_id=order.id,
                    calculated_at=now,
                    trigger_source=trigger_source,
                    algorithm_version=ALGORITHM_VERSION,
                    input_snapshot={
                        "pickup_lat": order.pickup_lat,
                        "pickup_lon": order.pickup_lon,
                        "delivery_lat": order.delivery_lat,
                        "delivery_lon": order.delivery_lon,
                        "requested_volume_m3": requested_volume,
                    },
                    candidates_snapshot={"candidates": candidates, "not_recommended": not_recommended, "message": snapshot["message"]},
                    recommended_driver_id=UUID(candidates[0]["driver_id"]) if candidates else None,
                    selected_driver_id=selected_driver_id,
                    distance_source=snapshot["distance_source"],
                    twogis_status=twogis_status,
                )
            )
            await session.flush()
        return snapshot

    async def latest(self, session: AsyncSession, order_id: UUID) -> dict | None:
        record = await session.scalar(
            select(OrderDistributionHistory)
            .where(OrderDistributionHistory.order_id == order_id)
            .order_by(OrderDistributionHistory.calculated_at.desc(), OrderDistributionHistory.id.desc())
            .limit(1)
        )
        if record is None:
            return None
        candidate_data = record.candidates_snapshot or {}
        return {
            "order_id": str(record.order_id),
            "calculated_at": record.calculated_at.isoformat(),
            "trigger_source": record.trigger_source,
            "algorithm_version": record.algorithm_version,
            "recommended_driver_id": str(record.recommended_driver_id) if record.recommended_driver_id else None,
            "selected_driver_id": str(record.selected_driver_id) if record.selected_driver_id else None,
            "distance_source": record.distance_source,
            "twogis_status": record.twogis_status,
            "message": candidate_data.get("message"),
            "candidates": candidate_data.get("candidates", []),
            "not_recommended": candidate_data.get("not_recommended", []),
        }

    async def _cycle_offer_ids(self, session: AsyncSession, order: Order) -> tuple[set[UUID], set[UUID]]:
        query = select(OrderOffer.driver_id, OrderOffer.status).where(OrderOffer.order_id == order.id)
        if order.dispatch_started_at is not None:
            query = query.where(OrderOffer.offered_at >= order.dispatch_started_at)
        rows = (await session.execute(query)).all()
        attempted = {driver_id for driver_id, _ in rows if driver_id is not None}
        rejected = {
            driver_id
            for driver_id, offer_status in rows
            if driver_id is not None and offer_status in {OrderOfferStatus.declined.value, OrderOfferStatus.expired.value}
        }
        return attempted, rejected

    @staticmethod
    def _hard_exclusion_reasons(
        driver: Driver,
        requested_volume: float | None,
        *,
        attempted_ids: set[UUID],
        rejected_ids: set[UUID],
        excluded_driver_ids: set[UUID],
        exclude_attempted_drivers: bool,
        allow_penalty_fallback: bool,
        now: datetime,
    ) -> list[str]:
        reasons: list[str] = []
        vehicle = driver.vehicle
        if not driver.is_active:
            reasons.append("driver_inactive")
        if driver.status != "available":
            reasons.append(f"status_{driver.status}")
        if not driver.is_on_shift:
            reasons.append("shift_off")
        if driver.moderation_status not in {"approved", "incomplete"}:
            reasons.append(f"driver_moderation_{driver.moderation_status}")
        if not driver.is_auto_dispatch_enabled:
            reasons.append("auto_dispatch_disabled")
        if not driver.is_dispatch_eligible:
            reasons.append("dispatch_admission_denied")
        if vehicle is None:
            reasons.append("vehicle_missing")
        else:
            if not vehicle.is_active:
                reasons.append("vehicle_inactive")
            if vehicle.moderation_status not in {"approved", "incomplete"}:
                reasons.append(f"vehicle_moderation_{vehicle.moderation_status}")
            if not _vehicle_matches_volume(vehicle, requested_volume):
                reasons.append("volume_mismatch")
        if driver.id in rejected_ids:
            reasons.append("already_rejected_or_expired")
        if exclude_attempted_drivers and driver.id in attempted_ids:
            reasons.append("already_attempted")
        if driver.id in excluded_driver_ids:
            reasons.append("explicitly_excluded")
        if not allow_penalty_fallback and driver.temporary_penalty_until and driver.temporary_penalty_until > now:
            reasons.append("temporary_penalty")
        return reasons

    @staticmethod
    def _base_row(driver: Driver, exclusion_reasons: list[str]) -> dict:
        vehicle = driver.vehicle
        return {
            "driver_id": str(driver.id),
            "driver_name": driver.name,
            "driver_phone": driver.phone,
            "vehicle_title": vehicle.title if vehicle else None,
            "vehicle_volume_min": vehicle.cubature_min if vehicle else None,
            "vehicle_volume_max": vehicle.cubature_max if vehicle else None,
            "rate_mode": vehicle.rate_mode if vehicle else None,
            "fixed_rate": vehicle.fixed_rate if vehicle and vehicle.rate_mode == "fixed" else None,
            "rating": float(driver.rating),
            "is_dispatch_eligible": driver.is_dispatch_eligible,
            "dispatch_admission_score": driver.dispatch_admission_score,
            "dispatch_admission_comment": driver.dispatch_admission_comment,
            "dispatch_priority": driver.dispatch_priority,
            "last_offer_at": driver.last_offer_at.isoformat() if driver.last_offer_at else None,
            "location_lat": driver.last_lat,
            "location_lon": driver.last_lon,
            "reasons": [],
            "exclusion_reasons": exclusion_reasons,
        }

    @staticmethod
    def _apply_scores(candidates: list[dict]) -> None:
        geo_scores = normalize_inverse([float(row["total_distance_km"]) for row in candidates])
        fixed_rates = [float(row["fixed_rate"]) for row in candidates if row["fixed_rate"] is not None]
        rate_by_driver: dict[str, float] = {}
        if fixed_rates:
            rate_scores = normalize_inverse(fixed_rates)
            rate_by_driver = {
                row["driver_id"]: score
                for row, score in zip((row for row in candidates if row["fixed_rate"] is not None), rate_scores, strict=True)
            }
        for row, geo_score in zip(candidates, geo_scores, strict=True):
            rating_score = (float(row["rating"]) - 1.0) / 4.0
            rate_score = rate_by_driver.get(row["driver_id"], 0.0)
            admission_score = float(row["dispatch_admission_score"] or 0) / 100.0
            row["score"] = round((0.50 * geo_score + 0.25 * rating_score + 0.15 * rate_score + 0.10 * admission_score) * 100, 2)
            reasons = [
                f"distance_driver_to_pickup_km:{round(float(row['driver_to_pickup_km']), 1)}",
                f"rating:{float(row['rating']):.1f}",
                "vehicle_volume_match",
                f"dispatch_admission_score:{row['dispatch_admission_score']}",
            ]
            if row["fixed_rate"] is not None:
                reasons.append(f"fixed_rate:{row['fixed_rate']}")
            elif row["rate_mode"] == "per_ton_km":
                reasons.append("rate_not_compared_per_ton_km")
            row["reasons"] = reasons

    @staticmethod
    def _sort_key(row: dict) -> tuple:
        last_offer_at = row.get("last_offer_at") or ""
        return (-float(row.get("score") or 0), -int(row.get("dispatch_priority") or 0), float(row.get("total_distance_km") or math.inf), last_offer_at, row["driver_id"])


smart_matching_service = SmartMatchingService()
