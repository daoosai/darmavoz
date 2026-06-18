from datetime import datetime, UTC
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import exists, func, select
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
from app.schemas.catalog import (
    DeliveryOptionCreate,
    DeliveryOptionOut,
    DeliveryOptionUpdate,
    MaterialCreate,
    MaterialOut,
    MaterialUpdate,
)
from app.schemas.driver import AdminDriverCreate, AdminDriverUpdate, DriverResponse, VehicleOut
from app.security.auth import (
    get_current_admin_user,
    get_current_logist_user,
    get_current_manager_user,
    get_password_hash,
)
from app.utils.phones import normalize_phone

router = APIRouter()


@router.get("/stats")
async def get_admin_stats(current_admin: User = Depends(get_current_admin_user)):
    return {"status": "ok", "message": "Admin area", "role": current_admin.role.name}


@router.get("/logist-area")
async def get_logist_area(current_user: User = Depends(get_current_logist_user)):
    return {"status": "ok", "message": "Logist area", "role": current_user.role.name}


@router.get("/manager-area")
async def get_manager_area(current_user: User = Depends(get_current_manager_user)):
    return {"status": "ok", "message": "Manager area", "role": current_user.role.name}


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
    return list(result.scalars().all())


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
        raise HTTPException(status_code=409, detail="Driver with this phone already exists")

    user_stmt = select(User).where(User.username == phone)
    if exclude_user_id is not None:
        user_stmt = user_stmt.where(User.id != exclude_user_id)
    if await db.scalar(user_stmt) is not None:
        raise HTTPException(status_code=409, detail="User with this phone already exists")


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
        raise HTTPException(status_code=409, detail="Vehicle is already assigned to another driver")


def _build_vehicle_title(driver_name: str, delivery_option: DeliveryOption) -> str:
    return f"{delivery_option.title} / {driver_name}"


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
            raise HTTPException(status_code=400, detail="Password is required for driver without auth user")
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

    vehicle = await _assign_vehicle_by_delivery_option(
        db,
        driver_name=payload.name,
        delivery_option_id=payload.delivery_option_id,
    )
    role = await _get_driver_role(db)
    await _ensure_vehicle_is_free(db, vehicle.id)
    user = User(
        username=normalized_phone,
        hashed_password=get_password_hash(payload.password),
        role_id=role.id,
        is_active=True,
    )
    db.add(user)
    await db.flush()

    driver = Driver(
        name=payload.name,
        phone=normalized_phone,
        user_id=user.id,
        vehicle_id=vehicle.id,
        status=payload.status,
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

    next_phone = normalize_phone(payload.phone) if payload.phone is not None else driver.phone
    await _ensure_unique_driver_phone(
        db,
        next_phone,
        exclude_driver_id=driver.id,
        exclude_user_id=driver.user_id,
    )

    if payload.vehicle_id is not None:
        vehicle = await _get_vehicle_or_404(db, payload.vehicle_id)
        if payload.delivery_option_id is not None and vehicle.delivery_option_id != payload.delivery_option_id:
            raise HTTPException(status_code=400, detail="Vehicle does not match delivery option")
        await _ensure_vehicle_is_free(db, vehicle.id, exclude_driver_id=driver.id)
        driver.vehicle_id = vehicle.id
    elif payload.delivery_option_id is not None:
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

    if payload.name is not None:
        driver.name = payload.name
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


@router.post("/drivers/{driver_id}/approve", response_model=DriverResponse)
async def approve_driver(
    driver_id: UUID,
    payload: ModerationDecisionPayload | None = Body(default=None),
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    driver = await _load_driver_or_404(db, driver_id)
    _set_driver_moderation(
        driver,
        ModerationStatus.approved.value,
        comment=payload.comment if payload else None,
        admin_user_id=current_admin.id,
    )
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
    _set_driver_moderation(
        driver,
        ModerationStatus.rejected.value,
        comment=payload.comment if payload else None,
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
    _set_driver_moderation(
        driver,
        ModerationStatus.suspended.value,
        comment=payload.comment if payload else None,
        admin_user_id=current_admin.id,
    )
    await db.commit()
    return await _load_driver_or_404(db, driver_id)


@router.post("/vehicles/{vehicle_id}/approve", response_model=dict[str, str | bool])
async def approve_vehicle(
    vehicle_id: UUID,
    payload: ModerationDecisionPayload | None = Body(default=None),
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    vehicle = await _load_vehicle_or_404(db, vehicle_id)
    _set_vehicle_moderation(
        vehicle,
        ModerationStatus.approved.value,
        comment=payload.comment if payload else None,
        admin_user_id=current_admin.id,
    )
    await db.commit()
    return {"ok": True, "moderation_status": vehicle.moderation_status}


@router.post("/vehicles/{vehicle_id}/reject", response_model=dict[str, str | bool])
async def reject_vehicle(
    vehicle_id: UUID,
    payload: ModerationDecisionPayload | None = Body(default=None),
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    vehicle = await _load_vehicle_or_404(db, vehicle_id)
    _set_vehicle_moderation(
        vehicle,
        ModerationStatus.rejected.value,
        comment=payload.comment if payload else None,
        admin_user_id=current_admin.id,
    )
    await db.commit()
    return {"ok": True, "moderation_status": vehicle.moderation_status}


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
        if order.status in {OrderStatus.driver_assigned.value, OrderStatus.in_progress.value}:
            order.status = OrderStatus.created.value

    driver.vehicle_id = None

    if offer_ids:
        offers = await db.scalars(select(OrderOffer).where(OrderOffer.id.in_(offer_ids)))
        for offer in offers.all():
            await db.delete(offer)

    await db.delete(driver)
    if user is not None:
        await db.delete(user)
    await db.commit()
    return DeleteResult(action="deleted", detail="Driver deleted permanently")


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
    return list(result.scalars().all())


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
    delivery_options = await _get_active_delivery_options(db)
    await _attach_media(db, [material], delivery_options)
    return _attach_delivery_options([material], delivery_options)[0]


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
    return material


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
    return material


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
    return list(result.scalars().all())


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
    return delivery_option


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
    return delivery_option


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
    return delivery_option


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
