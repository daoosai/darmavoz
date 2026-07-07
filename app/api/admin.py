from datetime import date as date_type
from datetime import datetime, UTC
import re
from uuid import UUID, uuid4

from fastapi import APIRouter, Body, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.database import get_db
from app.api.catalog import _attach_delivery_options, _attach_media, _get_active_delivery_options
from app.integrations.avito.client import AvitoAPIClient
from app.integrations.avito.management import AvitoManagementService
from app.models.models import (
    CartItem,
    DeliveryOption,
    Driver,
    ModerationStatus,
    DriverStatus,
    MediaFile,
    Material,
    Order,
    OrderStatus,
    OrderItem,
    OrderOffer,
    Role,
    User,
    Vehicle,
)
from app.schemas.client import ClientFcmTokenIn, ClientFcmTokenOut
from app.schemas.catalog import (
    DeliveryOptionCreate,
    DeliveryOptionOut,
    DeliveryOptionUpdate,
    MaterialCreate,
    MaterialOut,
    MaterialUpdate,
)
from app.schemas.driver import (
    AdminCarOut,
    AdminCarDriverOut,
    AdminCarStatsOut,
    AdminDriverCreate,
    AdminDriverUpdate,
    DriverResponse,
    PendingModerationItemOut,
    VehicleModerationDecisionOut,
    VehicleOut,
)
from app.schemas.order import OrderDeleteOut, OrderOut, OrderUpdate
from app.security.auth import (
    get_current_admin_user,
    get_current_logist_user,
    get_current_manager_user,
    get_password_hash,
)
from app.utils.phones import normalize_phone
from app.services.dispatch_service import delete_order_by_id, list_recent_orders, update_order_by_logist
from app.services.vehicle_moderation import (
    REQUIRED_VEHICLE_MEDIA_SLOTS,
    vehicle_has_required_photos,
    vehicle_has_required_profile,
)

router = APIRouter()
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _error_detail(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


@router.get("/stats")
async def get_admin_stats(current_admin: User = Depends(get_current_admin_user)):
    return {"status": "ok", "message": "Admin area", "role": current_admin.role.name}


class AdminMeOut(BaseModel):
    username: str
    email: str | None = None
    role: str | None = None


class AdminMeUpdate(BaseModel):
    email: str | None = None

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if not normalized:
            return None
        if not EMAIL_RE.match(normalized):
            raise ValueError("Некорректный формат email")
        return normalized


@router.get("/me", response_model=AdminMeOut)
async def get_admin_me(current_admin: User = Depends(get_current_admin_user)) -> AdminMeOut:
    return AdminMeOut(
        username=current_admin.username,
        email=current_admin.email,
        role=current_admin.role.name if current_admin.role else None,
    )


@router.patch("/me", response_model=AdminMeOut)
async def update_admin_me(
    payload: AdminMeUpdate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
) -> AdminMeOut:
    normalized_email = payload.email
    if normalized_email is not None:
        email_taken = await db.scalar(
            select(exists().where(func.lower(User.email) == normalized_email).where(User.id != current_admin.id))
        )
        if email_taken:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=_error_detail("ADMIN_EMAIL_ALREADY_IN_USE", "Email уже используется"),
            )

    current_admin.email = normalized_email
    await db.commit()
    await db.refresh(current_admin)
    return AdminMeOut(
        username=current_admin.username,
        email=current_admin.email,
        role=current_admin.role.name if current_admin.role else None,
    )


@router.get("/logist-area")
async def get_logist_area(current_user: User = Depends(get_current_logist_user)):
    return {"status": "ok", "message": "Logist area", "role": current_user.role.name}


@router.get("/manager-area")
async def get_manager_area(current_user: User = Depends(get_current_manager_user)):
    return {"status": "ok", "message": "Manager area", "role": current_user.role.name}


@router.get("/orders", response_model=list[OrderOut])
async def list_admin_panel_orders(
    driver_id: UUID | None = None,
    date: date_type | None = None,
    is_deleted: bool = False,
    show_deleted: bool | None = None,
    current_user: User = Depends(get_current_logist_user),
    db: AsyncSession = Depends(get_db),
) -> list[Order]:
    del current_user
    deleted_filter = show_deleted if show_deleted is not None else is_deleted
    return await list_recent_orders(db, driver_id=driver_id, created_on=date, is_deleted=deleted_filter)


@router.patch("/orders/{order_id}", response_model=OrderOut)
async def update_admin_order(
    order_id: UUID,
    payload: OrderUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> Order:
    del current_user
    return await update_order_by_logist(db, order_id=order_id, payload=payload)


@router.delete("/orders/{order_id}", response_model=OrderDeleteOut)
async def delete_admin_order(
    order_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> OrderDeleteOut:
    del current_user
    await delete_order_by_id(db, order_id)
    return OrderDeleteOut(ok=True, message="Заказ перемещен в архив")


class WebhookRegistrationRequest(BaseModel):
    webhook_url: str


class DeleteResult(BaseModel):
    ok: bool = True
    action: str
    detail: str


async def _get_driver_role(db: AsyncSession) -> Role:
    role = await db.scalar(select(Role).where(Role.name == "driver"))
    if role is None:
        role = Role(name="driver", description="Driver application user")
        db.add(role)
        await db.flush()
    return role


async def _get_delivery_option_or_404(db: AsyncSession, delivery_option_id: UUID) -> DeliveryOption:
    delivery_option = await db.get(DeliveryOption, delivery_option_id)
    if delivery_option is None or not delivery_option.is_active:
        raise HTTPException(status_code=404, detail="Delivery option not found")
    return delivery_option


async def _get_vehicle_or_404(db: AsyncSession, vehicle_id: UUID) -> Vehicle:
    vehicle = await db.get(Vehicle, vehicle_id)
    if vehicle is None or not vehicle.is_active:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return vehicle


async def _load_vehicle_or_404(db: AsyncSession, vehicle_id: UUID) -> Vehicle:
    result = await db.execute(
        select(Vehicle)
        .execution_options(populate_existing=True)
        .options(selectinload(Vehicle.delivery_option))
        .where(Vehicle.id == vehicle_id)
    )
    vehicle = result.scalar_one_or_none()
    if vehicle is None:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return vehicle


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


async def _load_driver_or_404(db: AsyncSession, driver_id: UUID) -> Driver:
    result = await db.execute(
        select(Driver)
        .execution_options(populate_existing=True)
        .options(
            selectinload(Driver.user),
            selectinload(Driver.vehicle).selectinload(Vehicle.delivery_option),
        )
        .where(Driver.id == driver_id)
    )
    driver = result.scalar_one_or_none()
    if driver is None:
        raise HTTPException(status_code=404, detail="Driver not found")
    if driver.vehicle is not None:
        await _attach_vehicle_media(db, [driver.vehicle])
    return driver


async def _list_admin_drivers(db: AsyncSession) -> list[Driver]:
    result = await db.execute(
        select(Driver)
        .options(
            selectinload(Driver.user),
            selectinload(Driver.vehicle).selectinload(Vehicle.delivery_option),
        )
        .order_by(Driver.name.asc())
    )
    drivers = list(result.scalars().all())
    await _attach_vehicle_media(db, [driver.vehicle for driver in drivers if driver.vehicle is not None])
    return drivers


async def _list_admin_vehicles(db: AsyncSession) -> list[Vehicle]:
    result = await db.execute(
        select(Vehicle)
        .options(selectinload(Vehicle.delivery_option))
        .where(Vehicle.is_active.is_(True))
        .order_by(Vehicle.created_at.desc(), Vehicle.title.asc())
    )
    vehicles = list(result.scalars().all())
    await _attach_vehicle_media(db, vehicles)
    return vehicles


async def _attach_delivery_option_media(
    db: AsyncSession,
    delivery_options: list[DeliveryOption],
) -> list[DeliveryOption]:
    await _attach_media(db, [], delivery_options)
    return delivery_options


async def _attach_material_media(
    db: AsyncSession,
    materials: list[Material],
) -> list[Material]:
    delivery_options = await _get_active_delivery_options(db)
    await _attach_media(db, materials, delivery_options)
    return _attach_delivery_options(materials, delivery_options)


def _resolve_moderation_comment(payload: "ModerationDecisionPayload | None") -> str | None:
    if payload is None:
        return None
    if payload.reject_reason:
        return payload.reject_reason
    return payload.comment


def _collect_vehicle_slot_urls(vehicle: Vehicle | None) -> dict[str, str | None]:
    slot_urls = {
        "vehicle_main_url": None,
        "vehicle_left_url": None,
        "vehicle_plate_url": None,
    }
    if vehicle is None:
        return slot_urls
    for media_file in getattr(vehicle, "media_files", []):
        if media_file.slot_key == "vehicle_main":
            slot_urls["vehicle_main_url"] = media_file.public_url
        elif media_file.slot_key == "vehicle_left":
            slot_urls["vehicle_left_url"] = media_file.public_url
        elif media_file.slot_key == "vehicle_plate":
            slot_urls["vehicle_plate_url"] = media_file.public_url
    return slot_urls


ADMIN_CAR_VOLUME_BUCKETS = ("5", "10", "17", "20", "25", "30")
ADMIN_CAR_BLOCKED_STATUSES = {ModerationStatus.rejected.value, ModerationStatus.suspended.value}


def _resolve_vehicle_volume(vehicle: Vehicle | None) -> float | None:
    if vehicle is None:
        return None

    candidates = [
        vehicle.body_volume_m3,
        vehicle.delivery_option.capacity_m3 if vehicle.delivery_option is not None else None,
        vehicle.cubature_max,
        vehicle.cubature_min,
    ]
    for candidate in candidates:
        if candidate is not None:
            return float(candidate)
    return None


def _normalize_admin_car_volume_bucket(value: float | None) -> str | None:
    if value is None:
        return None

    rounded = int(round(float(value)))
    if abs(float(value) - rounded) > 0.05:
        return None

    bucket = str(rounded)
    if bucket not in ADMIN_CAR_VOLUME_BUCKETS:
        return None
    return bucket


def _is_admin_car_blocked(driver: Driver, vehicle: Vehicle | None) -> bool:
    if vehicle is None:
        return True
    if not driver.is_active or not vehicle.is_active:
        return True
    if driver.moderation_status in ADMIN_CAR_BLOCKED_STATUSES:
        return True
    if vehicle.moderation_status in ADMIN_CAR_BLOCKED_STATUSES:
        return True
    return False


def _resolve_admin_car_status(driver: Driver, vehicle: Vehicle | None) -> str:
    if _is_admin_car_blocked(driver, vehicle):
        return "Заблокирован"
    if driver.status == DriverStatus.busy.value:
        return "Занят"
    if driver.status == DriverStatus.offline.value:
        return "Недоступен"
    return "Свободен"


def _normalize_admin_car_status_filter(status_value: str | None) -> str | None:
    if status_value is None:
        return None

    normalized = status_value.strip().lower()
    if not normalized:
        return None

    aliases = {
        "свободен": "available",
        "available": "available",
        "free": "available",
        "занят": "busy",
        "busy": "busy",
        "недоступен": "offline",
        "offline": "offline",
        "заблокирован": "blocked",
        "blocked": "blocked",
    }
    return aliases.get(normalized, normalized)


def _resolve_admin_car_photo_url(vehicle: Vehicle | None) -> str | None:
    if vehicle is None:
        return None

    fallback_url: str | None = None
    for media_file in getattr(vehicle, "media_files", []):
        if media_file.public_url and fallback_url is None:
            fallback_url = media_file.public_url
        if media_file.slot_key == "vehicle_main" and media_file.public_url:
            return media_file.public_url
        if media_file.is_primary and media_file.public_url:
            fallback_url = media_file.public_url
    return fallback_url


def _build_admin_car_item(driver: Driver) -> AdminCarOut | None:
    vehicle = driver.vehicle
    if vehicle is None:
        return None

    return AdminCarOut(
        id=vehicle.id,
        plate_number=vehicle.plate_number,
        volume=_resolve_vehicle_volume(vehicle),
        car_type=vehicle.vehicle_type,
        photo_url=_resolve_admin_car_photo_url(vehicle),
        driver=AdminCarDriverOut(
            id=driver.id,
            name=driver.name,
            phone=driver.phone,
            status=_resolve_admin_car_status(driver, vehicle),
        ),
    )


async def _list_admin_cars(
    db: AsyncSession,
    *,
    volume: float | None = None,
    car_type: str | None = None,
    status_value: str | None = None,
    plate_number: str | None = None,
    driver_id: UUID | None = None,
    driver_name: str | None = None,
) -> list[AdminCarOut]:
    stmt = (
        select(Driver)
        .join(Vehicle, Driver.vehicle_id == Vehicle.id)
        .outerjoin(DeliveryOption, Vehicle.delivery_option_id == DeliveryOption.id)
        .options(
            selectinload(Driver.user),
            selectinload(Driver.vehicle).selectinload(Vehicle.delivery_option),
        )
        .where(Driver.vehicle_id.is_not(None))
    )

    if volume is not None:
        stmt = stmt.where(
            func.coalesce(
                Vehicle.body_volume_m3,
                DeliveryOption.capacity_m3,
                Vehicle.cubature_max,
                Vehicle.cubature_min,
            ) == float(volume)
        )
    if car_type:
        stmt = stmt.where(Vehicle.vehicle_type.ilike(f"%{car_type.strip()}%"))
    if plate_number:
        stmt = stmt.where(Vehicle.plate_number.ilike(f"%{plate_number.strip()}%"))
    if driver_id is not None:
        stmt = stmt.where(Driver.id == driver_id)
    if driver_name:
        stmt = stmt.where(Driver.name.ilike(f"%{driver_name.strip()}%"))

    normalized_status = _normalize_admin_car_status_filter(status_value)
    blocked_clause = or_(
        Driver.is_active.is_(False),
        Vehicle.is_active.is_(False),
        Driver.moderation_status.in_(tuple(ADMIN_CAR_BLOCKED_STATUSES)),
        Vehicle.moderation_status.in_(tuple(ADMIN_CAR_BLOCKED_STATUSES)),
    )
    if normalized_status == "blocked":
        stmt = stmt.where(blocked_clause)
    elif normalized_status == "busy":
        stmt = stmt.where(~blocked_clause).where(Driver.status == DriverStatus.busy.value)
    elif normalized_status == "offline":
        stmt = stmt.where(~blocked_clause).where(Driver.status == DriverStatus.offline.value)
    elif normalized_status == "available":
        stmt = stmt.where(~blocked_clause).where(Driver.status == DriverStatus.available.value)

    result = await db.execute(stmt.order_by(Driver.name.asc(), Vehicle.created_at.desc()))
    drivers = list(result.scalars().unique().all())
    await _attach_vehicle_media(db, [driver.vehicle for driver in drivers if driver.vehicle is not None])

    items: list[AdminCarOut] = []
    for driver in drivers:
        item = _build_admin_car_item(driver)
        if item is not None:
            items.append(item)
    return items


async def _get_admin_car_stats(db: AsyncSession) -> AdminCarStatsOut:
    stmt = (
        select(Driver)
        .join(Vehicle, Driver.vehicle_id == Vehicle.id)
        .outerjoin(DeliveryOption, Vehicle.delivery_option_id == DeliveryOption.id)
        .options(selectinload(Driver.vehicle).selectinload(Vehicle.delivery_option))
        .where(Driver.vehicle_id.is_not(None))
        .where(Driver.is_active.is_(True))
        .where(Vehicle.is_active.is_(True))
        .where(Driver.moderation_status == ModerationStatus.approved.value)
        .where(Vehicle.moderation_status == ModerationStatus.approved.value)
    )
    result = await db.execute(stmt)
    drivers = list(result.scalars().unique().all())

    counts = {bucket: 0 for bucket in ADMIN_CAR_VOLUME_BUCKETS}
    for driver in drivers:
        bucket = _normalize_admin_car_volume_bucket(_resolve_vehicle_volume(driver.vehicle))
        if bucket is not None:
            counts[bucket] += 1

    return AdminCarStatsOut(
        volume_5=counts["5"],
        volume_10=counts["10"],
        volume_17=counts["17"],
        volume_20=counts["20"],
        volume_25=counts["25"],
        volume_30=counts["30"],
    )


async def _list_pending_moderation_items(db: AsyncSession) -> list[PendingModerationItemOut]:
    result = await db.execute(
        select(Driver)
        .options(
            selectinload(Driver.vehicle).selectinload(Vehicle.delivery_option),
            selectinload(Driver.user),
        )
        .where(Driver.vehicle_id.is_not(None))
        .where(
            Vehicle.moderation_status == ModerationStatus.pending_moderation.value
        )
        .join(Vehicle, Driver.vehicle_id == Vehicle.id)
        .order_by(Driver.id.asc())
    )
    drivers = list(result.scalars().unique().all())
    await _attach_vehicle_media(db, [driver.vehicle for driver in drivers if driver.vehicle is not None])

    items: list[PendingModerationItemOut] = []
    for driver in drivers:
        vehicle = driver.vehicle
        if vehicle is None:
            continue
        if not vehicle_has_required_profile(vehicle):
            continue
        slot_urls = _collect_vehicle_slot_urls(vehicle)
        matched_slots = {
            media_file.slot_key
            for media_file in getattr(vehicle, "media_files", [])
            if media_file.slot_key in REQUIRED_VEHICLE_MEDIA_SLOTS
        }
        if matched_slots != REQUIRED_VEHICLE_MEDIA_SLOTS:
            continue
        if not vehicle_has_required_photos(getattr(vehicle, "media_files", [])):
            continue
        items.append(
            PendingModerationItemOut(
                driver_id=driver.id,
                driver_name=driver.name,
                driver_phone=driver.phone,
                driver_moderation_status=driver.moderation_status,
                driver_moderation_comment=driver.moderation_comment,
                vehicle_id=vehicle.id,
                vehicle_brand=vehicle.brand,
                vehicle_model=vehicle.model,
                vehicle_plate_number=vehicle.plate_number,
                vehicle_cubature_min=vehicle.cubature_min,
                vehicle_cubature_max=vehicle.cubature_max,
                vehicle_tonnage_min=vehicle.tonnage_min,
                vehicle_tonnage_max=vehicle.tonnage_max,
                vehicle_type=vehicle.vehicle_type,
                vehicle_moderation_status=vehicle.moderation_status,
                vehicle_moderation_comment=vehicle.moderation_comment,
                vehicle_main_url=slot_urls["vehicle_main_url"],
                vehicle_left_url=slot_urls["vehicle_left_url"],
                vehicle_plate_url=slot_urls["vehicle_plate_url"],
                media_files=list(getattr(vehicle, "media_files", [])),
            )
        )
    return items


async def _ensure_unique_driver_phone(
    db: AsyncSession,
    phone: str,
    *,
    exclude_driver_id: UUID | None = None,
    exclude_user_id: UUID | None = None,
) -> None:
    driver_stmt = select(Driver).where(Driver.phone == phone)
    if exclude_driver_id is not None:
        driver_stmt = driver_stmt.where(Driver.id != exclude_driver_id)
    if await db.scalar(driver_stmt) is not None:
        raise HTTPException(
            status_code=409,
            detail=_error_detail("DRIVER_PHONE_ALREADY_EXISTS", "Водитель с таким номером телефона уже существует"),
        )

    user_stmt = select(User).where(User.username == phone)
    if exclude_user_id is not None:
        user_stmt = user_stmt.where(User.id != exclude_user_id)
    if await db.scalar(user_stmt) is not None:
        raise HTTPException(
            status_code=409,
            detail=_error_detail("DRIVER_PHONE_ALREADY_EXISTS", "Водитель с таким номером телефона уже существует"),
        )


async def _find_free_vehicle(db: AsyncSession, delivery_option_id: UUID) -> Vehicle | None:
    result = await db.execute(
        select(Vehicle)
        .where(Vehicle.delivery_option_id == delivery_option_id)
        .where(Vehicle.is_active.is_(True))
        .where(~exists(select(Driver.id).where(Driver.vehicle_id == Vehicle.id)))
        .order_by(Vehicle.created_at.asc(), Vehicle.title.asc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _ensure_vehicle_is_free(
    db: AsyncSession,
    vehicle_id: UUID,
    *,
    exclude_driver_id: UUID | None = None,
) -> None:
    stmt = select(Driver).where(Driver.vehicle_id == vehicle_id)
    if exclude_driver_id is not None:
        stmt = stmt.where(Driver.id != exclude_driver_id)
    if await db.scalar(stmt) is not None:
        raise HTTPException(
            status_code=409,
            detail=_error_detail("VEHICLE_ALREADY_ASSIGNED", "Транспорт уже назначен другому водителю"),
        )


def _build_vehicle_title(driver_name: str, delivery_option: DeliveryOption) -> str:
    return f"{delivery_option.title} / {driver_name}"


def _build_admin_vehicle_title(*, brand: str, plate_number: str, fallback_title: str) -> str:
    parts = [part.strip() for part in (brand, plate_number) if part and part.strip()]
    return " / ".join(parts) if parts else fallback_title


def _build_deleted_unique_value(value: str | None, *, max_length: int, marker: str = "_del_") -> str:
    suffix = f"{marker}{uuid4().hex[:6]}"
    base = (value or "deleted").strip() or "deleted"
    if len(base) + len(suffix) > max_length:
        base = base[: max_length - len(suffix)]
    return f"{base}{suffix}"


def _set_driver_moderation(driver: Driver, moderation_status: str, *, comment: str | None, admin_user_id: UUID) -> None:
    driver.moderation_status = moderation_status
    driver.moderation_comment = comment
    driver.moderated_at = datetime.now(UTC)
    driver.moderated_by_user_id = admin_user_id


def _set_vehicle_moderation(vehicle: Vehicle, moderation_status: str, *, comment: str | None, admin_user_id: UUID) -> None:
    vehicle.moderation_status = moderation_status
    vehicle.moderation_comment = comment
    vehicle.moderated_at = datetime.now(UTC)
    vehicle.moderated_by_user_id = admin_user_id


def _promote_driver_to_available_if_ready(driver: Driver) -> None:
    if driver.status in {DriverStatus.offline.value, "unavailable", None}:
        driver.status = DriverStatus.available.value


async def _assign_vehicle_by_delivery_option(
    db: AsyncSession,
    *,
    driver_name: str,
    delivery_option_id: UUID,
) -> Vehicle:
    delivery_option = await _get_delivery_option_or_404(db, delivery_option_id)
    vehicle = await _find_free_vehicle(db, delivery_option_id)
    if vehicle is not None:
        return vehicle

    vehicle = Vehicle(
        title=_build_vehicle_title(driver_name, delivery_option),
        delivery_option_id=delivery_option.id,
        is_active=True,
        notes="Auto-created for admin driver onboarding",
        moderation_status=ModerationStatus.approved.value,
    )
    db.add(vehicle)
    await db.flush()
    return vehicle


async def _ensure_driver_user(
    db: AsyncSession,
    *,
    driver: Driver,
    phone: str,
    password: str | None,
) -> User:
    role = await _get_driver_role(db)
    user = driver.user

    if user is None:
        if not password:
            raise HTTPException(
                status_code=400,
                detail=_error_detail("DRIVER_PASSWORD_REQUIRED", "Для водителя без учётной записи нужно указать пароль"),
            )
        user = User(
            username=phone,
            hashed_password=get_password_hash(password),
            role_id=role.id,
            is_active=True,
        )
        db.add(user)
        await db.flush()
        driver.user_id = user.id
        driver.user = user
        return user

    user.username = phone
    user.role_id = role.id
    if password:
        user.hashed_password = get_password_hash(password)
    return user


@router.get("/cars/stats", response_model=AdminCarStatsOut)
async def get_admin_cars_stats(
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    return await _get_admin_car_stats(db)


@router.get("/cars", response_model=list[AdminCarOut])
async def list_admin_cars(
    volume: float | None = None,
    car_type: str | None = None,
    status: str | None = None,
    plate_number: str | None = None,
    driver_id: UUID | None = None,
    driver_name: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    return await _list_admin_cars(
        db,
        volume=volume,
        car_type=car_type,
        status_value=status,
        plate_number=plate_number,
        driver_id=driver_id,
        driver_name=driver_name,
    )


@router.get("/drivers", response_model=list[DriverResponse])
async def list_admin_drivers(
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    return await _list_admin_drivers(db)


@router.get("/drivers/{driver_id}", response_model=DriverResponse)
async def get_admin_driver(
    driver_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    return await _load_driver_or_404(db, driver_id)


@router.get("/vehicles", response_model=list[VehicleOut])
async def list_admin_vehicles(
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    return await _list_admin_vehicles(db)


@router.post("/drivers", response_model=DriverResponse, status_code=status.HTTP_201_CREATED)
async def create_admin_driver(
    payload: AdminDriverCreate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    normalized_phone = normalize_phone(payload.phone)
    await _ensure_unique_driver_phone(db, normalized_phone)

    role = await _get_driver_role(db)
    user = User(
        username=normalized_phone,
        hashed_password=get_password_hash(payload.password),
        role_id=role.id,
        is_active=True,
    )
    db.add(user)
    await db.flush()

    vehicle = Vehicle(
        title=_build_admin_vehicle_title(
            brand=payload.vehicle_brand,
            plate_number=payload.vehicle_plate_number,
            fallback_title=payload.name,
        ),
        brand=payload.vehicle_brand,
        plate_number=payload.vehicle_plate_number,
        vehicle_type=payload.vehicle_type,
        cubature_min=payload.cubature_min,
        cubature_max=payload.cubature_max,
        tonnage_min=payload.tonnage_min,
        tonnage_max=payload.tonnage_max,
        delivery_option_id=payload.delivery_option_id,
        is_active=True,
        notes="Created by admin onboarding",
        moderation_status=ModerationStatus.approved.value,
    )
    db.add(vehicle)
    await db.flush()

    driver = Driver(
        name=payload.name,
        phone=normalized_phone,
        user_id=user.id,
        vehicle_id=vehicle.id,
        status=DriverStatus.available.value if payload.is_active else DriverStatus.offline.value,
        is_active=payload.is_active,
        is_auto_dispatch_enabled=payload.is_auto_dispatch_enabled,
        dispatch_priority=payload.dispatch_priority,
        moderation_status=ModerationStatus.approved.value,
        moderated_at=datetime.now(UTC),
        moderated_by_user_id=current_admin.id,
    )
    db.add(driver)
    _set_vehicle_moderation(vehicle, ModerationStatus.approved.value, comment="Approved by admin onboarding", admin_user_id=current_admin.id)
    await db.commit()
    return await _load_driver_or_404(db, driver.id)


@router.patch("/drivers/{driver_id}", response_model=DriverResponse)
async def update_admin_driver(
    driver_id: UUID,
    payload: AdminDriverUpdate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    driver = await _load_driver_or_404(db, driver_id)
    vehicle_profile_fields = {
        "brand": payload.vehicle_brand,
        "plate_number": payload.vehicle_plate_number,
        "vehicle_type": payload.vehicle_type,
        "cubature_min": payload.cubature_min,
        "cubature_max": payload.cubature_max,
        "tonnage_min": payload.tonnage_min,
        "tonnage_max": payload.tonnage_max,
    }
    has_vehicle_profile_updates = any(value is not None for value in vehicle_profile_fields.values())

    next_phone = normalize_phone(payload.phone) if payload.phone is not None else driver.phone
    await _ensure_unique_driver_phone(
        db,
        next_phone,
        exclude_driver_id=driver.id,
        exclude_user_id=driver.user_id,
    )

    if payload.vehicle_id is not None:
        vehicle = await _get_vehicle_or_404(db, payload.vehicle_id)
        await _ensure_vehicle_is_free(db, vehicle.id, exclude_driver_id=driver.id)
        driver.vehicle_id = vehicle.id
        driver.vehicle = vehicle
    elif payload.delivery_option_id is not None and not has_vehicle_profile_updates:
        if (
            driver.vehicle is not None
            and driver.vehicle.is_active
            and driver.vehicle.delivery_option_id == payload.delivery_option_id
        ):
            driver.vehicle_id = driver.vehicle.id
        else:
            vehicle = await _assign_vehicle_by_delivery_option(
                db,
                driver_name=payload.name or driver.name,
                delivery_option_id=payload.delivery_option_id,
            )
            await _ensure_vehicle_is_free(db, vehicle.id, exclude_driver_id=driver.id)
            driver.vehicle_id = vehicle.id
            driver.vehicle = vehicle

    if payload.delivery_option_id is not None or has_vehicle_profile_updates:
        vehicle = driver.vehicle
        if vehicle is None:
            vehicle = Vehicle(
                title=_build_admin_vehicle_title(
                    brand=payload.vehicle_brand,
                    plate_number=payload.vehicle_plate_number,
                    fallback_title=payload.name or driver.name,
                ),
                delivery_option_id=payload.delivery_option_id,
                is_active=True,
                notes="Created by admin update",
                moderation_status=ModerationStatus.approved.value,
            )
            db.add(vehicle)
            await db.flush()
            driver.vehicle_id = vehicle.id
            driver.vehicle = vehicle

        if payload.delivery_option_id is not None:
            await _get_delivery_option_or_404(db, payload.delivery_option_id)
            vehicle.delivery_option_id = payload.delivery_option_id

        for field, value in vehicle_profile_fields.items():
            if value is not None:
                setattr(vehicle, field, value)

        vehicle.title = _build_admin_vehicle_title(
            brand=vehicle.brand,
            plate_number=vehicle.plate_number,
            fallback_title=payload.name or driver.name,
        )

    if payload.name is not None:
        driver.name = payload.name
        if driver.vehicle is not None and not any(
            part and part.strip() for part in (driver.vehicle.brand, driver.vehicle.plate_number)
        ):
            driver.vehicle.title = _build_admin_vehicle_title(
                brand=driver.vehicle.brand,
                plate_number=driver.vehicle.plate_number,
                fallback_title=driver.name,
            )
    if payload.phone is not None:
        driver.phone = next_phone
    if payload.status is not None:
        driver.status = payload.status
    if payload.is_active is not None:
        driver.is_active = payload.is_active
        if not payload.is_active:
            driver.status = DriverStatus.offline.value
    if payload.is_auto_dispatch_enabled is not None:
        driver.is_auto_dispatch_enabled = payload.is_auto_dispatch_enabled
    if payload.dispatch_priority is not None:
        driver.dispatch_priority = payload.dispatch_priority

    await _ensure_driver_user(
        db,
        driver=driver,
        phone=driver.phone,
        password=payload.password,
    )
    await db.commit()
    return await _load_driver_or_404(db, driver.id)


class ModerationDecisionPayload(BaseModel):
    comment: str | None = None
    reject_reason: str | None = None


@router.post("/drivers/{driver_id}/approve", response_model=DriverResponse)
async def approve_driver(
    driver_id: UUID,
    payload: ModerationDecisionPayload | None = Body(default=None),
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    driver = await _load_driver_or_404(db, driver_id)
    comment = _resolve_moderation_comment(payload)
    _set_driver_moderation(
        driver,
        ModerationStatus.approved.value,
        comment=comment,
        admin_user_id=current_admin.id,
    )
    if driver.vehicle is not None and driver.vehicle.moderation_status != ModerationStatus.suspended.value:
        _set_vehicle_moderation(
            driver.vehicle,
            ModerationStatus.approved.value,
            comment=comment,
            admin_user_id=current_admin.id,
        )
    _promote_driver_to_available_if_ready(driver)
    await db.commit()
    return await _load_driver_or_404(db, driver_id)


@router.post("/drivers/{driver_id}/reject", response_model=DriverResponse)
async def reject_driver(
    driver_id: UUID,
    payload: ModerationDecisionPayload | None = Body(default=None),
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    driver = await _load_driver_or_404(db, driver_id)
    comment = _resolve_moderation_comment(payload)
    _set_driver_moderation(
        driver,
        ModerationStatus.rejected.value,
        comment=comment,
        admin_user_id=current_admin.id,
    )
    if driver.vehicle is not None and driver.vehicle.moderation_status != ModerationStatus.suspended.value:
        _set_vehicle_moderation(
            driver.vehicle,
            ModerationStatus.rejected.value,
            comment=comment,
            admin_user_id=current_admin.id,
        )
    await db.commit()
    return await _load_driver_or_404(db, driver_id)


@router.post("/drivers/{driver_id}/suspend", response_model=DriverResponse)
async def suspend_driver(
    driver_id: UUID,
    payload: ModerationDecisionPayload | None = Body(default=None),
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    driver = await _load_driver_or_404(db, driver_id)
    comment = _resolve_moderation_comment(payload)
    _set_driver_moderation(
        driver,
        ModerationStatus.suspended.value,
        comment=comment,
        admin_user_id=current_admin.id,
    )
    if driver.vehicle is not None:
        _set_vehicle_moderation(
            driver.vehicle,
            ModerationStatus.suspended.value,
            comment=comment,
            admin_user_id=current_admin.id,
        )
    await db.commit()
    return await _load_driver_or_404(db, driver_id)


@router.get("/moderation/pending", response_model=list[PendingModerationItemOut])
@router.get("/moderation/pending/", response_model=list[PendingModerationItemOut], include_in_schema=False)
async def list_pending_moderation(
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    return await _list_pending_moderation_items(db)


@router.patch("/vehicles/{vehicle_id}/approve", response_model=VehicleModerationDecisionOut)
@router.post("/vehicles/{vehicle_id}/approve", response_model=VehicleModerationDecisionOut, include_in_schema=False)
async def approve_vehicle(
    vehicle_id: UUID,
    payload: ModerationDecisionPayload | None = Body(default=None),
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    vehicle = await _load_vehicle_or_404(db, vehicle_id)
    comment = _resolve_moderation_comment(payload)
    _set_vehicle_moderation(
        vehicle,
        ModerationStatus.approved.value,
        comment=comment,
        admin_user_id=current_admin.id,
    )
    linked_driver = await db.scalar(select(Driver).where(Driver.vehicle_id == vehicle.id))
    if linked_driver is not None and linked_driver.moderation_status != ModerationStatus.suspended.value:
        _set_driver_moderation(
            linked_driver,
            ModerationStatus.approved.value,
            comment=comment,
            admin_user_id=current_admin.id,
        )
        _promote_driver_to_available_if_ready(linked_driver)
    await db.commit()
    return VehicleModerationDecisionOut(
        ok=True,
        moderation_status=vehicle.moderation_status,
        moderation_comment=vehicle.moderation_comment,
        driver_moderation_status=linked_driver.moderation_status if linked_driver is not None else None,
        driver_moderation_comment=linked_driver.moderation_comment if linked_driver is not None else None,
    )


@router.patch("/vehicles/{vehicle_id}/reject", response_model=VehicleModerationDecisionOut)
@router.post("/vehicles/{vehicle_id}/reject", response_model=VehicleModerationDecisionOut, include_in_schema=False)
async def reject_vehicle(
    vehicle_id: UUID,
    payload: ModerationDecisionPayload | None = Body(default=None),
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    vehicle = await _load_vehicle_or_404(db, vehicle_id)
    comment = _resolve_moderation_comment(payload)
    _set_vehicle_moderation(
        vehicle,
        ModerationStatus.rejected.value,
        comment=comment,
        admin_user_id=current_admin.id,
    )
    linked_driver = await db.scalar(select(Driver).where(Driver.vehicle_id == vehicle.id))
    if linked_driver is not None and linked_driver.moderation_status != ModerationStatus.suspended.value:
        _set_driver_moderation(
            linked_driver,
            ModerationStatus.rejected.value,
            comment=comment,
            admin_user_id=current_admin.id,
        )
    await db.commit()
    return VehicleModerationDecisionOut(
        ok=True,
        moderation_status=vehicle.moderation_status,
        moderation_comment=vehicle.moderation_comment,
        driver_moderation_status=linked_driver.moderation_status if linked_driver is not None else None,
        driver_moderation_comment=linked_driver.moderation_comment if linked_driver is not None else None,
    )


@router.post("/vehicles/{vehicle_id}/suspend", response_model=dict[str, str | bool])
async def suspend_vehicle(
    vehicle_id: UUID,
    payload: ModerationDecisionPayload | None = Body(default=None),
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    vehicle = await _load_vehicle_or_404(db, vehicle_id)
    _set_vehicle_moderation(
        vehicle,
        ModerationStatus.suspended.value,
        comment=payload.comment if payload else None,
        admin_user_id=current_admin.id,
    )
    await db.commit()
    return {"ok": True, "moderation_status": vehicle.moderation_status}


@router.delete("/drivers/{driver_id}", response_model=DeleteResult)
async def delete_admin_driver(
    driver_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    driver = await _load_driver_or_404(db, driver_id)
    user = driver.user

    offer_ids = list(
        (
            await db.scalars(
                select(OrderOffer.id).where(OrderOffer.driver_id == driver.id)
            )
        ).all()
    )
    if offer_ids:
        current_offer_orders = await db.scalars(
            select(Order).where(Order.current_offer_id.in_(offer_ids))
        )
        for order in current_offer_orders.all():
            order.current_offer_id = None

    assigned_orders = await db.scalars(select(Order).where(Order.driver_id == driver.id))
    for order in assigned_orders.all():
        order.driver_id = None
        order.assigned_at = None
        if order.status in {
            OrderStatus.driver_assigned.value,
            OrderStatus.driver_accepted.value,
            OrderStatus.heading_to_pickup.value,
            OrderStatus.arrived_at_pickup.value,
            OrderStatus.loading.value,
            OrderStatus.heading_to_client.value,
            OrderStatus.delivered.value,
        }:
            order.status = OrderStatus.created.value

    driver.vehicle_id = None
    driver.status = DriverStatus.offline.value
    driver.is_active = False
    driver.phone = _build_deleted_unique_value(driver.phone, max_length=20)

    if user is not None:
        user.is_active = False
        user.username = _build_deleted_unique_value(user.username, max_length=50)

    if offer_ids:
        offers = await db.scalars(select(OrderOffer).where(OrderOffer.id.in_(offer_ids)))
        for offer in offers.all():
            await db.delete(offer)

    await db.flush()
    await db.commit()

    try:
        await db.delete(driver)
        if user is not None:
            await db.delete(user)
        await db.commit()
        return DeleteResult(action="deleted", detail="Водитель удалён окончательно")
    except IntegrityError:
        await db.rollback()
        return DeleteResult(action="archived", detail="Водитель архивирован, номер телефона освобождён")


@router.post("/avito/webhook/register")
async def register_avito_webhook(
    request: WebhookRegistrationRequest,
    session: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    try:
        client = AvitoAPIClient()
        service = AvitoManagementService(client, session)
        return await service.register_webhook(request.webhook_url)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/materials/", response_model=list[MaterialOut])
async def get_all_materials(
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    result = await db.execute(select(Material).order_by(Material.sort_order.asc(), Material.name.asc()))
    materials = list(result.scalars().all())
    return await _attach_material_media(db, materials)


@router.get("/materials/{material_id}", response_model=MaterialOut)
async def get_material_for_admin(
    material_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    material = await db.get(Material, material_id)
    if material is None:
        raise HTTPException(status_code=404, detail="Material not found")
    return (await _attach_material_media(db, [material]))[0]


@router.post("/materials/", response_model=MaterialOut, status_code=status.HTTP_201_CREATED)
async def create_material(
    material_in: MaterialCreate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    material = Material(**material_in.model_dump())
    db.add(material)
    await db.commit()
    await db.refresh(material)
    return (await _attach_material_media(db, [material]))[0]


@router.patch("/materials/{material_id}", response_model=MaterialOut)
async def update_material(
    material_id: UUID,
    material_update: MaterialUpdate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    material = await db.get(Material, material_id)
    if material is None:
        raise HTTPException(status_code=404, detail="Material not found")

    for key, value in material_update.model_dump(exclude_unset=True).items():
        setattr(material, key, value)

    await db.commit()
    await db.refresh(material)
    return (await _attach_material_media(db, [material]))[0]


@router.delete("/materials/{material_id}", response_model=DeleteResult)
async def delete_material(
    material_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    material = await db.get(Material, material_id)
    if material is None:
        raise HTTPException(status_code=404, detail="Material not found")

    linked_order_items_count = await db.scalar(
        select(func.count(OrderItem.id)).where(OrderItem.material_id == material_id)
    )
    linked_cart_items_count = await db.scalar(
        select(func.count(CartItem.id)).where(CartItem.material_id == material_id)
    )

    if linked_order_items_count or linked_cart_items_count:
        material.is_active = False
        await db.commit()
        return DeleteResult(
            action="hidden",
            detail="Material is linked to orders or cart items and was hidden instead of deleted",
        )

    await db.delete(material)
    await db.commit()
    return DeleteResult(action="deleted", detail="Material deleted")


@router.get("/delivery-options", response_model=list[DeliveryOptionOut])
async def list_delivery_options(
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    result = await db.execute(
        select(DeliveryOption).order_by(DeliveryOption.sort_order.asc(), DeliveryOption.capacity_m3.asc())
    )
    delivery_options = list(result.scalars().all())
    return await _attach_delivery_option_media(db, delivery_options)


@router.get("/delivery-options/{delivery_option_id}", response_model=DeliveryOptionOut)
async def get_delivery_option(
    delivery_option_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    delivery_option = await db.get(DeliveryOption, delivery_option_id)
    if delivery_option is None:
        raise HTTPException(status_code=404, detail="Delivery option not found")
    return (await _attach_delivery_option_media(db, [delivery_option]))[0]


@router.post("/delivery-options", response_model=DeliveryOptionOut, status_code=status.HTTP_201_CREATED)
async def create_delivery_option(
    payload: DeliveryOptionCreate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    delivery_option = DeliveryOption(**payload.model_dump())
    db.add(delivery_option)
    await db.commit()
    await db.refresh(delivery_option)
    return (await _attach_delivery_option_media(db, [delivery_option]))[0]


@router.patch("/delivery-options/{delivery_option_id}", response_model=DeliveryOptionOut)
async def update_delivery_option(
    delivery_option_id: UUID,
    payload: DeliveryOptionUpdate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    delivery_option = await db.get(DeliveryOption, delivery_option_id)
    if delivery_option is None:
        raise HTTPException(status_code=404, detail="Delivery option not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(delivery_option, field, value)

    await db.commit()
    await db.refresh(delivery_option)
    return (await _attach_delivery_option_media(db, [delivery_option]))[0]


@router.delete("/delivery-options/{delivery_option_id}", response_model=DeleteResult)
async def delete_delivery_option(
    delivery_option_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    delivery_option = await db.get(DeliveryOption, delivery_option_id)
    if delivery_option is None:
        raise HTTPException(status_code=404, detail="Delivery option not found")

    linked_orders_count = await db.scalar(
        select(func.count(Order.id)).where(Order.delivery_option_id == delivery_option_id)
    )
    linked_vehicles_count = await db.scalar(
        select(func.count(Vehicle.id)).where(Vehicle.delivery_option_id == delivery_option_id)
    )
    if linked_orders_count or linked_vehicles_count:
        delivery_option.is_active = False
        await db.commit()
        return DeleteResult(
            action="hidden",
            detail="Delivery option is linked to orders or vehicles and was hidden instead of deleted",
        )

    await db.delete(delivery_option)
    await db.commit()
    return DeleteResult(action="deleted", detail="Delivery option deleted")
