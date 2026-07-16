import logging
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.database import get_db
from app.models.models import DeliveryOption, Driver, DriverStatus, MediaFile, ModerationStatus, Order, OrderStatus, Role, User, Vehicle
from app.schemas.driver import (
    DriverFcmTokenIn,
    DriverFcmTokenOut,
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
from app.schemas.order import DriverAssignedOrderOut, DriverOrderStatusUpdate, DriverOrderOut, OrderOut
from app.security.auth import get_current_approved_driver, get_current_driver
from app.services.dispatch_service import (
    accept_offer,
    decline_offer,
    get_current_assigned_order_for_driver,
    get_current_incoming_offer_for_driver,
    list_orders_for_driver,
    mask_phone,
    set_driver_order_status,
)
from app.services.email_service import send_email
from app.services.fcm_tokens import detach_fcm_token_from_other_entities
from app.services.vehicle_moderation import (
    REQUIRED_VEHICLE_MEDIA_SLOTS,
    set_incomplete_moderation,
    set_pending_moderation,
)
from app.utils.phones import normalize_phone

router = APIRouter()
logger = logging.getLogger(__name__)


def _build_vehicle_title(vehicle: Vehicle) -> str:
    parts = [part.strip() for part in [vehicle.brand or "", vehicle.model or "", vehicle.plate_number or ""] if part]
    return " / ".join(parts) if parts else "Черновик машины"


def _email_value(value: str | float | int | None) -> str:
    if value is None:
        return "Не указано"
    if isinstance(value, str):
        value = value.strip()
        return value or "Не указано"
    return str(value)


def _email_range(min_value: float | int | None, max_value: float | int | None) -> str:
    safe_min = _email_value(min_value)
    safe_max = _email_value(max_value)
    if safe_min == safe_max:
        return safe_min
    return f"{safe_min} - {safe_max}"


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
    del media_files
    if vehicle is None:
        if driver.moderation_status != ModerationStatus.suspended.value:
            set_incomplete_moderation(driver)
        return

    if vehicle.moderation_status != ModerationStatus.suspended.value:
        set_incomplete_moderation(vehicle)
    if driver.moderation_status != ModerationStatus.suspended.value:
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
        "cubature_min",
        "cubature_max",
        "tonnage_min",
        "tonnage_max",
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
        raise HTTPException(status_code=409, detail="Водитель с таким номером телефона уже существует")

    existing_user = await db.scalar(
        select(User).where(User.username == phone, User.id != current_user_id)
    )
    if existing_user is not None:
        raise HTTPException(status_code=409, detail="Водитель с таким номером телефона уже существует")


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
        pickup_address=order.pickup_address,
        pickup_lat=order.pickup_lat,
        pickup_lon=order.pickup_lon,
        delivery_address=order.delivery_address,
        delivery_lat=order.delivery_lat,
        delivery_lon=order.delivery_lon,
        notes=order.notes,
        client_phone_masked=mask_phone(order.client.phone if order.client else None),
        total_amount=order.total_amount or 0.0,
        delivery_cost=order.delivery_cost,
        estimated_total_amount=round((order.total_amount or 0.0) + (order.delivery_cost or 0.0), 2),
        delivery_option=order.delivery_option,
    )


def _serialize_driver_order_safe(order: Order) -> DriverOrderOut | None:
    try:
        return DriverOrderOut.model_validate(order, from_attributes=True)
    except ValidationError:
        logger.warning(
            "driver_order_payload_skipped",
            extra={"order_id": str(getattr(order, "id", ""))},
            exc_info=True,
        )
        return None


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
    current_driver: Driver = Depends(get_current_driver),
) -> DriverAssignedOrderOut:
    order = await get_current_assigned_order_for_driver(db, current_driver.id)
    if order is None:
        return DriverAssignedOrderOut()
    serialized_order = _serialize_driver_order_safe(order)
    if serialized_order is None:
        return DriverAssignedOrderOut()
    return DriverAssignedOrderOut(
        order_id=order.id,
        status=order.status,
        assigned_at=order.assigned_at,
        order=serialized_order,
    )


@router.get("/orders", response_model=list[DriverOrderOut])
async def get_driver_orders(
    db: AsyncSession = Depends(get_db),
    current_driver: Driver = Depends(get_current_driver),
) -> list[DriverOrderOut]:
    orders = await list_orders_for_driver(db, current_driver.id)
    serialized_orders: list[DriverOrderOut] = []
    for order in orders:
        serialized_order = _serialize_driver_order_safe(order)
        if serialized_order is not None:
            serialized_orders.append(serialized_order)
    return serialized_orders


@router.patch("/orders/{order_id}/status", response_model=OrderOut)
async def update_driver_order_status(
    order_id: UUID,
    payload: DriverOrderStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_driver: Driver = Depends(get_current_approved_driver),
) -> Order:
    return await set_driver_order_status(
        db,
        order_id=order_id,
        driver_id=current_driver.id,
        target_status=payload.status,
    )


@router.post("/orders/{order_id}/start", response_model=OrderOut)
async def start_driver_order(
    order_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_driver: Driver = Depends(get_current_approved_driver),
) -> Order:
    return await set_driver_order_status(
        db,
        order_id=order_id,
        driver_id=current_driver.id,
        target_status=OrderStatus.heading_to_pickup.value,
    )


@router.post("/orders/{order_id}/complete", response_model=OrderOut)
async def complete_driver_order(
    order_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_driver: Driver = Depends(get_current_approved_driver),
) -> Order:
    return await set_driver_order_status(
        db,
        order_id=order_id,
        driver_id=current_driver.id,
        target_status=OrderStatus.completed.value,
    )


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
        "cubature_min",
        "cubature_max",
        "tonnage_min",
        "tonnage_max",
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


@router.post("/vehicle/submit", response_model=DriverFullProfileResponse)
async def submit_driver_vehicle_for_moderation(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_driver: Driver = Depends(get_current_driver),
) -> Driver:
    driver = await _load_driver_with_vehicle(db, current_driver.id)
    vehicle = driver.vehicle

    if vehicle is None:
        raise HTTPException(status_code=400, detail="Vehicle profile is not created yet")
    if not driver.name or not driver.phone:
        raise HTTPException(status_code=400, detail="Driver profile is incomplete")
    if driver.moderation_status == ModerationStatus.suspended.value or vehicle.moderation_status == ModerationStatus.suspended.value:
        raise HTTPException(status_code=403, detail="Suspended profiles cannot be submitted")

    media_files = getattr(vehicle, "media_files", [])
    if not (
        vehicle.brand
        and vehicle.plate_number
        and vehicle.vehicle_type
        and (vehicle.cubature_max is not None or vehicle.cubature_min is not None)
    ):
        raise HTTPException(
            status_code=400,
            detail="Не заполнены обязательные текстовые данные автомобиля",
        )

    if {
        media_file.slot_key
        for media_file in media_files
        if media_file.slot_key in REQUIRED_VEHICLE_MEDIA_SLOTS
    } != REQUIRED_VEHICLE_MEDIA_SLOTS:
        raise HTTPException(
            status_code=400,
            detail="Необходимо загрузить все 3 фотографии автомобиля",
        )

    set_pending_moderation(vehicle)
    set_pending_moderation(driver)
    await db.commit()

    admin_users = (
        await db.execute(
            select(User)
            .join(Role, User.role_id == Role.id)
            .where(Role.name == "admin", User.email.is_not(None))
        )
    ).scalars().all()
    body = (
        f"Здравствуйте!\n\n"
        f"Водитель {_email_value(driver.name)} ({_email_value(driver.phone)}) отправил данные автомобиля на проверку.\n\n"
        f"Информация об автомобиле:\n"
        f"- Марка/Модель: {vehicle.brand or 'Не указано'}\n"
        f"- Госномер: {vehicle.plate_number or 'Не указано'}\n"
        f"- Тип машины: {vehicle.vehicle_type or 'Не указано'}\n"
        f"- Кубатура (м³): {_email_range(vehicle.cubature_min, vehicle.cubature_max)}\n"
        f"- Тоннаж (т): {_email_range(vehicle.tonnage_min, vehicle.tonnage_max)}\n\n"
        f"Пожалуйста, зайдите в панель администратора для проверки."
    )
    for admin_user in admin_users:
        if admin_user.email:
            background_tasks.add_task(
                send_email,
                to_email=admin_user.email,
                subject="ДАРМАВОЗ: Новая заявка на модерацию!",
                body=body,
            )

    return await _load_driver_with_vehicle(db, driver.id)


@router.post("/fcm-token", response_model=DriverFcmTokenOut)
async def save_driver_fcm_token(
    payload: DriverFcmTokenIn,
    db: AsyncSession = Depends(get_db),
    current_driver: Driver = Depends(get_current_driver),
) -> DriverFcmTokenOut:
    normalized_token = payload.token.strip()
    logger.info(
        "driver_fcm_token_save_requested",
        extra={
            "driver_id": str(current_driver.id),
            "token_prefix": normalized_token[:24],
        },
    )
    await detach_fcm_token_from_other_entities(
        db,
        normalized_token,
        keep_driver_id=current_driver.id,
    )
    current_driver.fcm_token = normalized_token
    await db.commit()
    return DriverFcmTokenOut(ok=True, token=current_driver.fcm_token)


@router.delete("/fcm-token", response_model=DriverFcmTokenOut)
async def delete_driver_fcm_token(
    db: AsyncSession = Depends(get_db),
    current_driver: Driver = Depends(get_current_driver),
) -> DriverFcmTokenOut:
    logger.info(
        "driver_fcm_token_deleted",
        extra={"driver_id": str(current_driver.id)},
    )
    current_driver.fcm_token = None
    await db.commit()
    return DriverFcmTokenOut(ok=True, token=None)


@router.patch("/profile/status", response_model=dict[str, str | bool])
async def update_driver_status(
    payload: DriverStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_driver: Driver = Depends(get_current_driver),
) -> dict[str, str | bool]:
    current_driver.status = payload.status
    await db.commit()
    return {"ok": True, "status": current_driver.status}
