from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.database import get_db
from app.models.models import DeliveryOption, Driver, DriverStatus, MediaFile, ModerationStatus, Order, OrderStatus, User, Vehicle
from app.schemas.driver import (
    DriverResponse,
    DriverFullProfileResponse,
    DriverIncomingOfferOut,
    DriverOfferDecisionIn,
    DriverOfferDecisionOut,
    DriverOfferOrderOut,
    DriverProfileUpdate,
    DriverStatusUpdate,
    DriverVehicleUpdate,
)
from app.schemas.order import DriverAssignedOrderOut, OrderOut
from app.security.auth import get_current_approved_driver, get_current_driver
from app.services.dispatch_service import (
    accept_offer,
    add_event,
    decline_offer,
    get_current_assigned_order_for_driver,
    get_current_incoming_offer_for_driver,
    get_order_by_id,
    list_orders_for_driver,
    mask_phone,
)
from app.services.vehicle_moderation import (
    REQUIRED_VEHICLE_MEDIA_SLOTS,
    set_incomplete_moderation,
    set_pending_moderation,
    vehicle_is_ready_for_moderation,
)
from app.utils.phones import normalize_phone

router = APIRouter()


def _build_vehicle_title(vehicle: Vehicle) -> str:
    parts = [part.strip() for part in [vehicle.brand or "", vehicle.model or "", vehicle.plate_number or ""] if part]
    return " / ".join(parts) if parts else "Черновик машины"


async def _attach_vehicle_media(db: AsyncSession, vehicle: Vehicle | None) -> None:
    if vehicle is None:
        return
    result = await db.execute(
        select(MediaFile)
        .where(MediaFile.entity_type == "vehicle", MediaFile.entity_id == vehicle.id)
        .order_by(MediaFile.is_primary.desc(), MediaFile.created_at.asc())
    )
    vehicle.media_files = list(result.scalars().all())


async def _load_driver_with_vehicle(db: AsyncSession, driver_id: UUID) -> Driver:
    result = await db.execute(
        select(Driver)
        .options(selectinload(Driver.vehicle).selectinload(Vehicle.delivery_option))
        .where(Driver.id == driver_id)
    )
    driver = result.scalar_one()
    await _attach_vehicle_media(db, driver.vehicle)
    return driver


def _sync_driver_vehicle_moderation(driver: Driver, vehicle: Vehicle | None, media_files: list[MediaFile] | None) -> None:
    if vehicle is None:
        set_incomplete_moderation(driver)
        return

    if vehicle_is_ready_for_moderation(vehicle, media_files or []):
        set_pending_moderation(vehicle)
        set_pending_moderation(driver)
        return

    set_incomplete_moderation(vehicle)
    set_incomplete_moderation(driver)


def _has_driver_critical_changes(driver: Driver, payload: DriverProfileUpdate) -> bool:
    return (
        (payload.name is not None and payload.name != driver.name)
        or (payload.phone is not None and payload.phone != driver.phone)
    )


def _has_vehicle_critical_changes(vehicle: Vehicle, payload: DriverVehicleUpdate) -> bool:
    critical_fields = (
        "brand",
        "model",
        "plate_number",
        "vehicle_type",
        "body_volume_m3",
        "delivery_option_id",
        "rate_mode",
        "rate_per_ton_km",
        "fixed_rate",
    )
    return any(getattr(payload, field) is not None and getattr(payload, field) != getattr(vehicle, field) for field in critical_fields)


async def _validate_unique_driver_phone(
    db: AsyncSession,
    *,
    phone: str,
    current_driver_id: UUID,
    current_user_id: UUID | None,
) -> None:
    existing_driver = await db.scalar(
        select(Driver).where(Driver.phone == phone, Driver.id != current_driver_id)
    )
    if existing_driver is not None:
        raise HTTPException(status_code=409, detail="Driver with this phone already exists")

    existing_user = await db.scalar(
        select(User).where(User.username == phone, User.id != current_user_id)
    )
    if existing_user is not None:
        raise HTTPException(status_code=409, detail="User with this phone already exists")


async def _validate_delivery_option(db: AsyncSession, delivery_option_id: UUID) -> DeliveryOption:
    delivery_option = await db.get(DeliveryOption, delivery_option_id)
    if delivery_option is None or not delivery_option.is_active:
        raise HTTPException(status_code=404, detail="Delivery option not found")
    return delivery_option


def _validate_rate_fields(
    *,
    rate_mode: str | None,
    rate_per_ton_km: float | None,
    fixed_rate: float | None,
) -> None:
    if rate_mode is None:
        return
    if rate_mode == "per_ton_km":
        if rate_per_ton_km is None:
            raise HTTPException(status_code=400, detail="rate_per_ton_km is required for per_ton_km mode")
        if fixed_rate is not None:
            raise HTTPException(status_code=400, detail="fixed_rate must be empty for per_ton_km mode")
    elif rate_mode == "fixed":
        if fixed_rate is None:
            raise HTTPException(status_code=400, detail="fixed_rate is required for fixed mode")
        if rate_per_ton_km is not None:
            raise HTTPException(status_code=400, detail="rate_per_ton_km must be empty for fixed mode")
    else:
        raise HTTPException(status_code=400, detail="Unsupported rate_mode")


def _build_driver_order_payload(order: Order) -> DriverOfferOrderOut:
    item = order.items[0] if order.items else None
    return DriverOfferOrderOut(
        id=order.id,
        material_name=item.material.name if item and item.material else "",
        quantity=order.quantity,
        address=order.address,
        notes=order.notes,
        client_phone_masked=mask_phone(order.client.phone if order.client else None),
        delivery_option=order.delivery_option,
    )


@router.get("/orders/incoming/current", response_model=DriverIncomingOfferOut)
async def get_current_incoming_order(
    db: AsyncSession = Depends(get_db),
    current_driver: Driver = Depends(get_current_approved_driver),
) -> DriverIncomingOfferOut:
    offer = await get_current_incoming_offer_for_driver(db, current_driver.id)
    if offer is None or offer.order is None:
        return DriverIncomingOfferOut()

    seconds_left = None
    if offer.expires_at is not None:
        seconds_left = max(0, int((offer.expires_at - datetime.now(UTC)).total_seconds()))

    return DriverIncomingOfferOut(
        offer_id=offer.id,
        order_id=offer.order_id,
        status=offer.status,
        expires_at=offer.expires_at,
        seconds_left=seconds_left,
        order=_build_driver_order_payload(offer.order),
    )


@router.post("/order-offers/{offer_id}/accept", response_model=DriverOfferDecisionOut)
async def accept_driver_offer(
    offer_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_driver: Driver = Depends(get_current_approved_driver),
) -> DriverOfferDecisionOut:
    order = await accept_offer(db, offer_id=offer_id, driver_id=current_driver.id)
    return DriverOfferDecisionOut(
        ok=True,
        offer_status="accepted",
        order_id=order.id,
        order_status=order.status,
        driver_status=current_driver.status,
    )


@router.post("/order-offers/{offer_id}/decline", response_model=DriverOfferDecisionOut)
async def decline_driver_offer(
    offer_id: UUID,
    payload: DriverOfferDecisionIn,
    db: AsyncSession = Depends(get_db),
    current_driver: Driver = Depends(get_current_approved_driver),
) -> DriverOfferDecisionOut:
    order = await decline_offer(
        db,
        offer_id=offer_id,
        driver_id=current_driver.id,
        reason=payload.reason,
    )
    return DriverOfferDecisionOut(
        ok=True,
        offer_status="declined",
        order_id=order.id,
        order_status=order.status,
        driver_status=current_driver.status,
        next_attempt_started=order.status in {"offered_to_driver", "no_driver_found"},
    )


@router.get("/orders/assigned/current", response_model=DriverAssignedOrderOut)
async def get_current_assigned_order(
    db: AsyncSession = Depends(get_db),
    current_driver: Driver = Depends(get_current_approved_driver),
) -> DriverAssignedOrderOut:
    order = await get_current_assigned_order_for_driver(db, current_driver.id)
    if order is None:
        return DriverAssignedOrderOut()
    return DriverAssignedOrderOut(
        order_id=order.id,
        status=order.status,
        assigned_at=order.assigned_at,
        order=order,
    )


@router.get("/orders", response_model=list[OrderOut])
async def get_driver_orders(
    db: AsyncSession = Depends(get_db),
    current_driver: Driver = Depends(get_current_approved_driver),
) -> list[Order]:
    return await list_orders_for_driver(db, current_driver.id)


@router.post("/orders/{order_id}/start", response_model=OrderOut)
async def start_driver_order(
    order_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_driver: Driver = Depends(get_current_approved_driver),
) -> Order:
    order = await get_order_by_id(db, order_id)
    if order.driver_id != current_driver.id:
        raise HTTPException(status_code=403, detail="Order does not belong to this driver")
    if order.status != OrderStatus.driver_assigned.value:
        raise HTTPException(status_code=409, detail="Order cannot be started in its current status")

    order.status = OrderStatus.in_progress.value
    await add_event(db, order.id, "driver_started_order", f"Driver {current_driver.id} started the order")
    await db.commit()
    return await get_order_by_id(db, order.id)


@router.post("/orders/{order_id}/complete", response_model=OrderOut)
async def complete_driver_order(
    order_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_driver: Driver = Depends(get_current_approved_driver),
) -> Order:
    order = await get_order_by_id(db, order_id)
    if order.driver_id != current_driver.id:
        raise HTTPException(status_code=403, detail="Order does not belong to this driver")
    if order.status not in {OrderStatus.driver_assigned.value, OrderStatus.in_progress.value}:
        raise HTTPException(status_code=409, detail="Order cannot be completed in its current status")

    order.status = OrderStatus.completed.value
    order.current_offer_id = None
    current_driver.status = DriverStatus.available.value
    await add_event(db, order.id, "driver_completed_order", f"Driver {current_driver.id} completed the order")
    await db.commit()
    return await get_order_by_id(db, order.id)


@router.get("/profile", response_model=DriverResponse)
async def get_driver_profile(
    db: AsyncSession = Depends(get_db),
    current_driver: Driver = Depends(get_current_driver),
) -> Driver:
    result = await db.execute(
        select(Driver)
        .options(selectinload(Driver.vehicle).selectinload(Vehicle.delivery_option))
        .where(Driver.id == current_driver.id)
    )
    return result.scalar_one()


@router.get("/profile/full", response_model=DriverFullProfileResponse)
async def get_driver_profile_full(
    db: AsyncSession = Depends(get_db),
    current_driver: Driver = Depends(get_current_driver),
) -> Driver:
    return await _load_driver_with_vehicle(db, current_driver.id)


@router.patch("/profile", response_model=DriverFullProfileResponse)
async def update_driver_profile(
    payload: DriverProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_driver: Driver = Depends(get_current_driver),
) -> Driver:
    normalized_phone = normalize_phone(payload.phone) if payload.phone is not None else None

    if payload.phone is not None:
        await _validate_unique_driver_phone(
            db,
            phone=normalized_phone,
            current_driver_id=current_driver.id,
            current_user_id=current_driver.user_id,
        )

    normalized_payload = payload.model_copy(update={"phone": normalized_phone})
    if _has_driver_critical_changes(current_driver, normalized_payload):
        _sync_driver_vehicle_moderation(current_driver, current_driver.vehicle, getattr(current_driver.vehicle, "media_files", []))

    if payload.name is not None:
        current_driver.name = payload.name
    if payload.phone is not None:
        current_driver.phone = normalized_phone
        if current_driver.user_id is not None:
            user = await db.get(User, current_driver.user_id)
            if user is not None:
                user.username = normalized_phone

    await db.commit()
    return await _load_driver_with_vehicle(db, current_driver.id)


@router.patch("/vehicle", response_model=DriverFullProfileResponse)
async def update_driver_vehicle(
    payload: DriverVehicleUpdate,
    db: AsyncSession = Depends(get_db),
    current_driver: Driver = Depends(get_current_driver),
) -> Driver:
    vehicle = current_driver.vehicle
    if vehicle is None:
        if payload.delivery_option_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="delivery_option_id is required for the first vehicle setup",
            )
        await _validate_delivery_option(db, payload.delivery_option_id)
        vehicle = Vehicle(
            title="Черновик машины",
            delivery_option_id=payload.delivery_option_id,
            moderation_status=ModerationStatus.incomplete.value,
            is_active=True,
        )
        db.add(vehicle)
        await db.flush()
        current_driver.vehicle_id = vehicle.id
        current_driver.vehicle = vehicle
    elif payload.delivery_option_id is not None:
        await _validate_delivery_option(db, payload.delivery_option_id)

    next_rate_mode = payload.rate_mode if payload.rate_mode is not None else vehicle.rate_mode
    next_rate_per_ton_km = (
        payload.rate_per_ton_km if payload.rate_per_ton_km is not None else vehicle.rate_per_ton_km
    )
    next_fixed_rate = payload.fixed_rate if payload.fixed_rate is not None else vehicle.fixed_rate
    _validate_rate_fields(
        rate_mode=next_rate_mode,
        rate_per_ton_km=next_rate_per_ton_km,
        fixed_rate=next_fixed_rate,
    )

    for field in (
        "brand",
        "model",
        "plate_number",
        "vehicle_type",
        "body_volume_m3",
        "delivery_option_id",
        "rate_mode",
        "rate_per_ton_km",
        "fixed_rate",
        "is_active",
        "notes",
    ):
        value = getattr(payload, field)
        if value is not None:
            setattr(vehicle, field, value)

    if vehicle.rate_mode == "per_ton_km":
        vehicle.fixed_rate = None
    elif vehicle.rate_mode == "fixed":
        vehicle.rate_per_ton_km = None

    vehicle.title = _build_vehicle_title(vehicle)
    await _attach_vehicle_media(db, vehicle)
    _sync_driver_vehicle_moderation(current_driver, vehicle, vehicle.media_files)
    await db.commit()
    return await _load_driver_with_vehicle(db, current_driver.id)


@router.patch("/profile/status", response_model=dict[str, str | bool])
async def update_driver_status(
    payload: DriverStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_driver: Driver = Depends(get_current_driver),
) -> dict[str, str | bool]:
    current_driver.status = payload.status
    await db.commit()
    return {"ok": True, "status": current_driver.status}
