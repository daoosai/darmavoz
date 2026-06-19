from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.database import get_db
from app.models.models import Driver, DriverStatus, MediaFile, OrderOffer, User, Vehicle
from app.schemas.driver import DriverCreate, DriverFleetResponse, DriverResponse
from app.security.auth import get_current_logist_user
from app.services.storage import StorageNotConfiguredError, get_storage_service

router = APIRouter()


async def _attach_vehicle_media(db: AsyncSession, vehicles: list[Vehicle]) -> None:
    vehicle_ids = [vehicle.id for vehicle in vehicles]
    if not vehicle_ids:
        return

    result = await db.execute(
        select(MediaFile)
        .where(MediaFile.entity_type == "vehicle", MediaFile.entity_id.in_(vehicle_ids))
        .order_by(MediaFile.is_primary.desc(), MediaFile.created_at.asc())
    )
    media_by_vehicle: dict[UUID, list[MediaFile]] = {vehicle_id: [] for vehicle_id in vehicle_ids}
    for media_file in result.scalars().all():
        media_by_vehicle.setdefault(media_file.entity_id, []).append(media_file)

    for vehicle in vehicles:
        vehicle.media_files = media_by_vehicle.get(vehicle.id, [])


def _collect_vehicle_slot_urls(
    vehicle: Vehicle | None,
    *,
    storage=None,
) -> dict[str, str | None]:
    slot_urls = {
        "vehicle_main_url": None,
        "vehicle_left_url": None,
    }
    if vehicle is None:
        return slot_urls

    for media_file in getattr(vehicle, "media_files", []):
        url = (
            storage.generate_presigned_get(media_file.object_key)
            if storage is not None
            else media_file.public_url
        )
        if media_file.slot_key == "vehicle_main":
            slot_urls["vehicle_main_url"] = url
        elif media_file.slot_key == "vehicle_left":
            slot_urls["vehicle_left_url"] = url

    return slot_urls


def _serialize_driver_fleet(
    driver: Driver,
    *,
    storage=None,
) -> DriverFleetResponse:
    vehicle = driver.vehicle
    slot_urls = _collect_vehicle_slot_urls(vehicle, storage=storage)
    payload = DriverResponse.model_validate(driver).model_dump(mode="python")
    return DriverFleetResponse(
        **payload,
        vehicle_type=vehicle.vehicle_type if vehicle is not None else None,
        vehicle_cubature_min=vehicle.cubature_min if vehicle is not None else None,
        vehicle_cubature_max=vehicle.cubature_max if vehicle is not None else None,
        vehicle_tonnage_min=vehicle.tonnage_min if vehicle is not None else None,
        vehicle_tonnage_max=vehicle.tonnage_max if vehicle is not None else None,
        vehicle_main_url=slot_urls["vehicle_main_url"],
        vehicle_left_url=slot_urls["vehicle_left_url"],
    )


def build_driver_list_query(
    *,
    delivery_option_id: UUID | None = None,
    status_filter: str | None = None,
) -> Select[tuple[Driver]]:
    stmt = (
        select(Driver)
        .join(Driver.user)
        .where(User.is_active.is_(True))
        .where(Driver.is_active.is_(True))
        .options(selectinload(Driver.vehicle).selectinload(Vehicle.delivery_option))
        .order_by(Driver.name.asc())
    )

    if status_filter:
        stmt = stmt.where(Driver.status == status_filter)
    if delivery_option_id:
        stmt = stmt.join(Driver.vehicle).where(Vehicle.delivery_option_id == delivery_option_id)

    return stmt


async def fetch_drivers(
    db: AsyncSession,
    *,
    delivery_option_id: UUID | None = None,
    status_filter: str | None = None,
) -> list[DriverFleetResponse]:
    result = await db.execute(
        build_driver_list_query(
            delivery_option_id=delivery_option_id,
            status_filter=status_filter,
        )
    )
    drivers = list(result.scalars().unique().all())
    await _attach_vehicle_media(db, [driver.vehicle for driver in drivers if driver.vehicle is not None])

    try:
        storage = get_storage_service()
    except StorageNotConfiguredError:
        storage = None

    return [_serialize_driver_fleet(driver, storage=storage) for driver in drivers]


@router.post("/", response_model=DriverResponse, status_code=status.HTTP_201_CREATED)
async def create_driver(
    payload: DriverCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    del current_user
    existing = await db.execute(select(Driver).where(Driver.phone == payload.phone))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Driver with this phone already exists",
        )

    if payload.vehicle_id is not None:
        vehicle = await db.get(Vehicle, payload.vehicle_id)
        if vehicle is None:
            raise HTTPException(status_code=404, detail="Vehicle not found")

    driver = Driver(
        name=payload.name,
        phone=payload.phone,
        status=payload.status or "offline",
        is_active=True,
        vehicle_id=payload.vehicle_id,
        is_auto_dispatch_enabled=payload.is_auto_dispatch_enabled,
        dispatch_priority=payload.dispatch_priority,
    )
    db.add(driver)
    await db.commit()
    result = await db.execute(
        select(Driver)
        .options(selectinload(Driver.vehicle).selectinload(Vehicle.delivery_option))
        .where(Driver.id == driver.id)
    )
    return result.scalar_one()


@router.get("/", response_model=List[DriverFleetResponse])
async def list_drivers(
    delivery_option_id: UUID | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    del current_user
    return await fetch_drivers(
        db,
        delivery_option_id=delivery_option_id,
        status_filter=status_filter,
    )


@router.delete("/{driver_id}", status_code=status.HTTP_200_OK)
async def delete_driver(
    driver_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> dict[str, str | bool]:
    del current_user
    result = await db.execute(
        select(Driver)
        .options(selectinload(Driver.user), selectinload(Driver.vehicle))
        .where(Driver.id == driver_id)
    )
    driver = result.scalar_one_or_none()
    if driver is None:
        raise HTTPException(status_code=404, detail="Driver not found")

    driver.is_active = False
    driver.status = DriverStatus.offline.value
    driver.vehicle_id = None
    driver.is_auto_dispatch_enabled = False

    pending_offers = await db.execute(
        select(OrderOffer).where(
            OrderOffer.driver_id == driver.id,
            OrderOffer.status == "pending",
        )
    )
    for offer in pending_offers.scalars().all():
        offer.status = "cancelled"

    await db.commit()
    return {"ok": True, "action": "deactivated", "detail": "Driver deactivated and unbound from vehicle"}
