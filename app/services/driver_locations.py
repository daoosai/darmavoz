import json
import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.models import Driver, DriverStatus, ModerationStatus, Order, User, Vehicle
from app.schemas.driver import DriverMapResponse
from app.services.dispatch_service import ACTIVE_ASSIGNED_ORDER_STATUSES
from app.services.redis_client import get_redis

logger = logging.getLogger(__name__)

LOCATION_KEY_PREFIX = "driver:location:"
MAP_STATUS_AVAILABLE = DriverStatus.available.value
MAP_STATUS_BUSY = DriverStatus.busy.value
MAP_STATUS_OFFLINE = DriverStatus.offline.value


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _location_key(driver_id: UUID) -> str:
    return f"{LOCATION_KEY_PREFIX}{driver_id}"


def _normalize_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _is_stale(updated_at: datetime | None, now: datetime) -> bool:
    normalized = _normalize_datetime(updated_at)
    if normalized is None:
        return True
    return normalized < now - timedelta(seconds=settings.DRIVER_LOCATION_TTL_SECONDS)


async def _driver_has_active_order(db: AsyncSession, driver_id: UUID) -> bool:
    order_id = await db.scalar(
        select(Order.id)
        .where(Order.driver_id == driver_id)
        .where(Order.status.in_(sorted(ACTIVE_ASSIGNED_ORDER_STATUSES)))
        .limit(1)
    )
    return order_id is not None


async def save_driver_location(
    db: AsyncSession,
    *,
    driver: Driver,
    lat: float,
    lon: float,
) -> datetime:
    received_at = _utcnow()
    driver.last_lat = lat
    driver.last_lon = lon
    driver.last_location_updated_at = received_at
    driver.status = (
        DriverStatus.busy.value
        if await _driver_has_active_order(db, driver.id)
        else DriverStatus.available.value
    )
    await db.commit()

    payload = json.dumps(
        {"lat": lat, "lon": lon, "updated_at": received_at.isoformat()},
        separators=(",", ":"),
    )
    try:
        await get_redis().set(
            _location_key(driver.id),
            payload,
            ex=settings.DRIVER_LOCATION_TTL_SECONDS,
        )
    except Exception:
        logger.warning("driver_location_redis_write_failed", extra={"driver_id": str(driver.id)})

    return received_at


async def set_driver_shift(
    db: AsyncSession,
    *,
    driver: Driver,
    is_on_shift: bool,
) -> None:
    was_on_shift = driver.is_on_shift
    driver.is_on_shift = is_on_shift
    # A fresh location after enabling a shift is required before the driver is available.
    if not is_on_shift or not was_on_shift:
        driver.status = DriverStatus.offline.value
    await db.commit()

    if not is_on_shift:
        try:
            await get_redis().delete(_location_key(driver.id))
        except Exception:
            logger.warning("driver_location_redis_delete_failed", extra={"driver_id": str(driver.id)})


async def _load_cached_locations(driver_ids: list[UUID]) -> dict[UUID, tuple[float, float, datetime]]:
    if not driver_ids:
        return {}

    try:
        raw_values = await get_redis().mget([_location_key(driver_id) for driver_id in driver_ids])
    except Exception:
        logger.warning("driver_location_redis_read_failed")
        return {}

    locations: dict[UUID, tuple[float, float, datetime]] = {}
    for driver_id, raw_value in zip(driver_ids, raw_values, strict=True):
        if not raw_value:
            continue
        try:
            value = json.loads(raw_value)
            updated_at = datetime.fromisoformat(value["updated_at"])
            locations[driver_id] = (float(value["lat"]), float(value["lon"]), _normalize_datetime(updated_at))
        except (KeyError, TypeError, ValueError):
            logger.warning("driver_location_redis_payload_invalid", extra={"driver_id": str(driver_id)})
    return locations


async def list_driver_map(db: AsyncSession) -> list[DriverMapResponse]:
    result = await db.execute(
        select(Driver)
        .join(Driver.user)
        .join(Driver.vehicle)
        .where(User.is_active.is_(True))
        .where(Driver.is_active.is_(True))
        .where(Driver.moderation_status == ModerationStatus.approved.value)
        .where(Vehicle.is_active.is_(True))
        .where(Vehicle.moderation_status == ModerationStatus.approved.value)
        .options(selectinload(Driver.vehicle))
        .order_by(Driver.name.asc())
    )
    drivers = list(result.scalars().unique().all())
    driver_ids = [driver.id for driver in drivers]
    cached_locations = await _load_cached_locations(driver_ids)

    active_order_rows = await db.execute(
        select(Order.driver_id)
        .where(Order.driver_id.in_(driver_ids))
        .where(Order.status.in_(sorted(ACTIVE_ASSIGNED_ORDER_STATUSES)))
    ) if driver_ids else None
    busy_driver_ids = {driver_id for (driver_id,) in active_order_rows.all()} if active_order_rows else set()

    now = _utcnow()
    response: list[DriverMapResponse] = []
    for driver in drivers:
        vehicle = driver.vehicle
        if vehicle is None:
            continue
        cached_location = cached_locations.get(driver.id)
        if cached_location is not None:
            last_lat, last_lon, updated_at = cached_location
        else:
            last_lat, last_lon = driver.last_lat, driver.last_lon
            updated_at = _normalize_datetime(driver.last_location_updated_at)

        last_location_is_stale = _is_stale(updated_at, now)
        if not driver.is_on_shift or last_location_is_stale:
            map_status = MAP_STATUS_OFFLINE
        elif driver.id in busy_driver_ids:
            map_status = MAP_STATUS_BUSY
        else:
            map_status = MAP_STATUS_AVAILABLE

        response.append(
            DriverMapResponse(
                id=driver.id,
                name=driver.name,
                phone=driver.phone,
                is_on_shift=driver.is_on_shift,
                map_status=map_status,
                last_lat=last_lat,
                last_lon=last_lon,
                last_location_updated_at=updated_at,
                last_location_is_stale=last_location_is_stale,
                vehicle_id=vehicle.id,
                vehicle_title=vehicle.title,
                vehicle_plate_number=vehicle.plate_number,
                vehicle_type=vehicle.vehicle_type,
                vehicle_cubature_min=vehicle.cubature_min,
                vehicle_cubature_max=vehicle.cubature_max,
                vehicle_tonnage_min=vehicle.tonnage_min,
                vehicle_tonnage_max=vehicle.tonnage_max,
            )
        )
    return response
