from __future__ import annotations

import logging
from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import Select, and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.models import (
    Client,
    ClientAddress,
    DeliveryOption,
    Driver,
    DriverStatus,
    EventLog,
    Material,
    ModerationStatus,
    Order,
    OrderEvent,
    Quarry,
    OrderItem,
    OrderOffer,
    OrderOfferStatus,
    OrderStatus,
    Vehicle,
)
from app.schemas.order import (
    DispatchHistoryAttemptOut,
    DispatchHistoryOut,
    LogistOrderCreate,
    OrderHistoryEventOut,
    OrderHistoryOut,
)
from app.services.notifications import (
    schedule_client_driver_assigned_notification,
    schedule_client_heading_to_client_notification,
    schedule_client_order_completed_notification,
    schedule_client_order_created_notification,
    schedule_driver_new_order_notification,
    schedule_driver_order_changed_notification,
    schedule_logist_driver_rejected_notification,
    schedule_logist_no_driver_found_notification,
    schedule_logist_timeout_notification,
)
from app.services.order_pricing import calculate_client_order_pricing, resolve_min_delivery_price
from app.services.redis_client import enqueue_dispatch_order
from app.utils.phones import normalize_phone

GUEST_CLIENT_PHONE = "00000000000"
GUEST_CLIENT_NAME = "Гость (Демо)"
MANUAL_ASSIGN_APPROVAL_ERROR = "Невозможно назначить заказ: профиль водителя или автомобиль не прошли модерацию"
logger = logging.getLogger(__name__)


def _driver_order_notification_snapshot(order: Order, item: OrderItem) -> tuple[object, ...]:
    return (
        order.delivery_address,
        order.delivery_lat,
        order.delivery_lon,
        round(order.total_amount, 2) if order.total_amount is not None else None,
        round(order.delivery_cost, 2) if order.delivery_cost is not None else None,
        order.quarry_id,
        item.material_id,
        order.delivery_option_id,
    )


DISPATCH_ALLOWED_MODERATION_STATUSES = {
    ModerationStatus.approved.value,
    ModerationStatus.incomplete.value,
}

ACTIVE_ASSIGNED_ORDER_STATUSES = {
    OrderStatus.driver_assigned.value,
    OrderStatus.driver_accepted.value,
    OrderStatus.heading_to_pickup.value,
    OrderStatus.arrived_at_pickup.value,
    OrderStatus.loading.value,
    OrderStatus.heading_to_client.value,
    OrderStatus.delivered.value,
}

FULL_ORDER_EDIT_STATUSES = {
    OrderStatus.created.value,
    OrderStatus.searching_driver.value,
    OrderStatus.no_driver_found.value,
    "timeout",
}


DRIVER_ORDER_STATUS_TRANSITIONS: dict[str, set[str]] = {
    OrderStatus.driver_assigned.value: {
        OrderStatus.driver_accepted.value,
        OrderStatus.heading_to_pickup.value,
    },
    OrderStatus.driver_accepted.value: {
        OrderStatus.heading_to_pickup.value,
    },
    OrderStatus.heading_to_pickup.value: {
        OrderStatus.arrived_at_pickup.value,
    },
    OrderStatus.arrived_at_pickup.value: {
        OrderStatus.loading.value,
        OrderStatus.heading_to_client.value,
    },
    OrderStatus.loading.value: {
        OrderStatus.heading_to_client.value,
    },
    OrderStatus.heading_to_client.value: {
        OrderStatus.delivered.value,
        OrderStatus.completed.value,
    },
    OrderStatus.delivered.value: {
        OrderStatus.completed.value,
    },
}


def active_order_clause() -> object:
    return Order.is_deleted.is_(False)


def utcnow() -> datetime:
    return datetime.now(UTC)


def mask_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    if len(phone) <= 7:
        return phone
    return f"{phone[:5]}***{phone[-4:]}"


def get_order_requested_volume(order: Order | None) -> float | None:
    if order is None:
        return None

    item_volumes = [item.volume for item in getattr(order, "items", []) if item.volume is not None]
    if item_volumes:
        return float(sum(item_volumes))

    if order.delivery_option is not None and getattr(order.delivery_option, "capacity_m3", None) is not None:
        return float(order.delivery_option.capacity_m3 * max(order.quantity, 1))

    return None


def get_order_material_name(order: Order | None) -> str:
    if order is None:
        return "Груз"

    for item in getattr(order, "items", []):
        material_name = getattr(getattr(item, "material", None), "name", None)
        if material_name:
            return material_name

    return "Груз"


def get_order_delivery_address(order: Order | None) -> str:
    if order is None:
        return "Адрес не указан"

    return order.delivery_address or order.address or "Адрес не указан"


def format_order_volume(order: Order | None) -> str:
    requested_volume = get_order_requested_volume(order)
    if requested_volume is None:
        return "0"
    return f"{requested_volume:g}"


def get_order_estimated_total_amount(order: Order | None) -> float:
    if order is None:
        return 0.0
    return round((order.total_amount or 0.0) + (order.delivery_cost or 0.0), 2)


def format_money(value: float | None) -> str:
    amount = round(float(value or 0.0), 2)
    formatted = f"{amount:,.2f}".replace(",", " " ).rstrip("0").rstrip(".")
    return f"{formatted} ₽"


def build_offer_push_message(order: Order) -> tuple[str, str]:
    material_name = get_order_material_name(order)
    volume = format_order_volume(order)
    address = get_order_delivery_address(order)
    title = f"🔥 Новый заказ: {material_name}, {volume} м³"
    body = (
        f"📍 Адрес: {address}. Доставка: {format_money(order.delivery_cost)}. "
        f"Итого: {format_money(get_order_estimated_total_amount(order))}. Нажмите, чтобы принять!"
    )
    return title, body


def build_manual_assign_push_message(order: Order) -> tuple[str, str]:
    material_name = get_order_material_name(order)
    volume = format_order_volume(order)
    address = get_order_delivery_address(order)
    title = "✅ Вы назначены на заказ!"
    body = (
        f"📍 Везем {material_name} ({volume} м³) по адресу: {address}. "
        f"Доставка: {format_money(order.delivery_cost)}. Итого: {format_money(get_order_estimated_total_amount(order))}."
    )
    return title, body


def build_vehicle_volume_match_clause(requested_volume: float | None):
    if requested_volume is None or requested_volume <= 0:
        return True

    return and_(
        or_(Vehicle.cubature_min.is_(None), Vehicle.cubature_min <= requested_volume),
        or_(Vehicle.cubature_max.is_(None), Vehicle.cubature_max >= requested_volume),
        or_(Vehicle.body_volume_m3.is_(None), Vehicle.body_volume_m3 >= requested_volume),
    )


def ensure_driver_vehicle_matches_order_volume(order: Order, driver: Driver) -> None:
    requested_volume = get_order_requested_volume(order)
    if requested_volume is None or requested_volume <= 0:
        return

    vehicle = driver.vehicle
    if vehicle is None:
        raise HTTPException(status_code=409, detail="Машина водителя не подходит под объем заказа")

    cubature_min = vehicle.cubature_min
    cubature_max = vehicle.cubature_max
    if (cubature_min is not None and requested_volume < cubature_min) or (
        cubature_max is not None and requested_volume > cubature_max
    ):
        raise HTTPException(status_code=409, detail="Машина водителя не подходит под объем заказа")


def schedule_new_order_push(order: Order, driver_id: UUID | None) -> None:
    if driver_id is None:
        return
    schedule_driver_new_order_notification(order, driver_id)


async def enqueue_order_for_dispatch_safe(order_id: UUID) -> None:
    try:
        await enqueue_dispatch_order(order_id)
    except Exception:
        logger.exception("dispatch_enqueue_failed", extra={"order_id": str(order_id)})



async def add_event(
    session: AsyncSession,
    order_id: UUID,
    event_type: str,
    description: str | None = None,
    *,
    order_status: str | None = None,
) -> None:
    session.add(EventLog(order_id=order_id, event_type=event_type, description=description))
    if order_status is None:
        order_status = await session.scalar(select(Order.status).where(Order.id == order_id))
    if order_status is not None:
        session.add(
            OrderEvent(
                order_id=order_id,
                status=order_status,
                event_type=event_type,
                description=description,
            )
        )
    await session.flush()


async def get_or_create_guest_client(session: AsyncSession) -> Client:
    result = await session.execute(select(Client).where(Client.phone == GUEST_CLIENT_PHONE))
    guest_client = result.scalar_one_or_none()
    if guest_client is None:
        guest_client = Client(name=GUEST_CLIENT_NAME, phone=GUEST_CLIENT_PHONE)
        session.add(guest_client)
        await session.flush()
    return guest_client


async def get_or_create_client_by_phone(session: AsyncSession, *, name: str, phone: str) -> Client:
    result = await session.execute(select(Client).where(Client.phone == phone))
    client = result.scalar_one_or_none()
    if client is None:
        client = Client(name=name, phone=phone)
        session.add(client)
        await session.flush()
        return client

    if client.name != name:
        client.name = name
        await session.flush()
    return client


async def validate_material_and_delivery_option(
    session: AsyncSession,
    *,
    material_id: UUID,
    delivery_option_id: UUID,
) -> tuple[Material, DeliveryOption]:
    material = await session.get(Material, material_id)
    if material is None or not material.is_active:
        raise HTTPException(status_code=404, detail="Material not found")

    delivery_option = await session.get(DeliveryOption, delivery_option_id)
    if delivery_option is None or not delivery_option.is_active:
        raise HTTPException(status_code=404, detail="Delivery option not found")

    return material, delivery_option


async def build_order(
    session: AsyncSession,
    *,
    client: Client,
    material: Material,
    delivery_option: DeliveryOption,
    address: str,
    notes: str | None,
    source: str | None,
    created_by_source: str,
    quantity: int,
    auto_dispatch: bool,
    pickup_address: str | None = None,
    pickup_lat: float | None = None,
    pickup_lon: float | None = None,
    delivery_address: str | None = None,
    delivery_lat: float | None = None,
    delivery_lon: float | None = None,
    mileage_km: float | None = None,
    delivery_rate_per_km_snapshot: float | None = None,
    delivery_cost: float | None = None,
    calculation_source: str | None = None,
    route_calculated_at: datetime | None = None,
    quarry_id: UUID | None = None,
) -> Order:
    volume = delivery_option.capacity_m3 * quantity
    unit_price = material.price
    amount = volume * unit_price if unit_price is not None else None
    now = utcnow()
    delivery_address_value = delivery_address or address
    order = Order(
        client_id=client.id,
        delivery_option_id=delivery_option.id,
        quarry_id=quarry_id,
        address=address,
        pickup_address=pickup_address,
        pickup_lat=pickup_lat,
        pickup_lon=pickup_lon,
        delivery_address=delivery_address_value,
        delivery_lat=delivery_lat,
        delivery_lon=delivery_lon,
        mileage_km=round(mileage_km, 2) if mileage_km is not None else None,
        delivery_rate_per_km_snapshot=delivery_rate_per_km_snapshot,
        delivery_cost=round(delivery_cost, 2) if delivery_cost is not None else None,
        calculation_source=calculation_source,
        route_calculated_at=route_calculated_at,
        notes=notes,
        source=source,
        created_by_source=created_by_source,
        status=OrderStatus.searching_driver.value if auto_dispatch else OrderStatus.created.value,
        total_amount=amount or 0.0,
        dispatch_started_at=now if auto_dispatch else None,
    )
    session.add(order)
    await session.flush()

    session.add(
        OrderItem(
            order_id=order.id,
            material_id=material.id,
            quantity=quantity,
            volume=volume,
            price=unit_price,
            amount=amount,
        )
    )
    await session.flush()

    await add_event(session, order.id, "order_created", f"Source: {created_by_source}")
    if auto_dispatch:
        await add_event(session, order.id, "dispatch_started", "Automatic dispatch started")
    return order


async def create_checkout_order(
    session: AsyncSession,
    *,
    client_id: UUID | None,
    material_id: UUID,
    delivery_option_id: UUID,
    delivery_address: str | None,
    notes: str | None,
    source: str | None,
    quantity: int,
    address_id: UUID | None = None,
    quarry_id: UUID | None = None,
    delivery_lat: float | None = None,
    delivery_lon: float | None = None,
    mileage_km: float | None = None,
) -> Order:
    if client_id is None:
        client = await get_or_create_guest_client(session)
    else:
        client = await session.get(Client, client_id)
        if client is None:
            raise HTTPException(status_code=404, detail="Client not found")

    material, delivery_option = await validate_material_and_delivery_option(
        session,
        material_id=material_id,
        delivery_option_id=delivery_option_id,
    )

    resolved_delivery_address = delivery_address
    resolved_delivery_lat = delivery_lat
    resolved_delivery_lon = delivery_lon

    if address_id is not None:
        address_result = await session.execute(
            select(ClientAddress).where(
                ClientAddress.id == address_id,
                ClientAddress.client_id == client.id,
            )
        )
        client_address = address_result.scalar_one_or_none()
        if client_address is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Address not found")

        if not resolved_delivery_address:
            resolved_delivery_address = client_address.full_address
        if resolved_delivery_lat is None:
            resolved_delivery_lat = client_address.lat
        if resolved_delivery_lon is None:
            resolved_delivery_lon = client_address.lon

    if not resolved_delivery_address:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="delivery_address or address_id is required",
        )

    selected_quarry: Quarry | None = None
    resolved_mileage_km: float | None = round(mileage_km, 2) if mileage_km is not None else None
    delivery_rate_per_km_snapshot: float | None = None
    delivery_cost: float | None = None
    route_calculated_at: datetime | None = None
    calculation_source: str | None = None

    if quarry_id is not None:
        selected_quarry = await session.get(Quarry, quarry_id)
        if selected_quarry is None or not selected_quarry.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quarry not found")

        if resolved_mileage_km is None:
            if resolved_delivery_lat is None or resolved_delivery_lon is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="mileage_km or delivery coordinates are required when quarry_id is provided",
                )

            pricing = await calculate_client_order_pricing(
                session,
                material_id=material_id,
                delivery_option_id=delivery_option_id,
                delivery_lat=resolved_delivery_lat,
                delivery_lon=resolved_delivery_lon,
                quantity=quantity,
                quarry_id=quarry_id,
            )
            selected_quarry = pricing.quarry
            resolved_mileage_km = pricing.mileage_km

        if delivery_option.delivery_rate_per_km is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Delivery rate is not configured",
            )

        delivery_rate_per_km_snapshot = round(float(delivery_option.delivery_rate_per_km), 2)
        delivery_cost = max(
            round(resolved_mileage_km * delivery_rate_per_km_snapshot, 2),
            resolve_min_delivery_price(delivery_option),
        )
        route_calculated_at = utcnow()
        calculation_source = "yandex_auto"
    elif (
        resolved_delivery_lat is not None
        and resolved_delivery_lon is not None
        and delivery_option.delivery_rate_per_km is not None
    ):
        pricing = await calculate_client_order_pricing(
            session,
            material_id=material_id,
            delivery_option_id=delivery_option_id,
            delivery_lat=resolved_delivery_lat,
            delivery_lon=resolved_delivery_lon,
            quantity=quantity,
        )
        selected_quarry = pricing.quarry
        resolved_mileage_km = pricing.mileage_km
        if pricing.delivery_option.delivery_rate_per_km is not None:
            delivery_rate_per_km_snapshot = round(float(pricing.delivery_option.delivery_rate_per_km), 2)
            delivery_cost = max(
                round(resolved_mileage_km * delivery_rate_per_km_snapshot, 2),
                resolve_min_delivery_price(pricing.delivery_option),
            )
        route_calculated_at = utcnow()
        calculation_source = "yandex_auto"

    order = await build_order(
        session,
        client=client,
        material=material,
        delivery_option=delivery_option,
        address=resolved_delivery_address,
        notes=notes,
        source=source or "mobile",
        created_by_source="client_app",
        quantity=quantity,
        auto_dispatch=True,
        pickup_address=(selected_quarry.address or selected_quarry.name) if selected_quarry is not None else None,
        pickup_lat=selected_quarry.lat if selected_quarry is not None else None,
        pickup_lon=selected_quarry.lon if selected_quarry is not None else None,
        delivery_address=resolved_delivery_address,
        delivery_lat=resolved_delivery_lat,
        delivery_lon=resolved_delivery_lon,
        mileage_km=resolved_mileage_km,
        delivery_rate_per_km_snapshot=delivery_rate_per_km_snapshot,
        delivery_cost=delivery_cost,
        calculation_source=calculation_source,
        route_calculated_at=route_calculated_at,
        quarry_id=selected_quarry.id if selected_quarry is not None else None,
    )

    await session.commit()
    schedule_client_order_created_notification(order)
    await enqueue_order_for_dispatch_safe(order.id)
    return await get_order_by_id(session, order.id)


async def _resolve_logist_order_quarry(
    session: AsyncSession,
    *,
    material_id: UUID,
    pickup_address: str | None,
) -> Quarry | None:
    result = await session.execute(
        select(Quarry)
        .join(Quarry.materials)
        .where(Quarry.is_active.is_(True), Material.id == material_id)
        .order_by(Quarry.name.asc())
    )
    quarries = list(result.scalars().unique().all())
    normalized_pickup_address = (pickup_address or "").strip().casefold()
    for quarry in quarries:
        if normalized_pickup_address and normalized_pickup_address in {quarry.name.strip().casefold(), quarry.address.strip().casefold()}:
            return quarry
    if len(quarries) == 1:
        return quarries[0]
    return None


async def create_logist_order(session: AsyncSession, payload: LogistOrderCreate) -> Order:
    client = await get_or_create_client_by_phone(
        session, name=payload.client_name or payload.client_phone, phone=payload.client_phone
    )
    material, delivery_option = await validate_material_and_delivery_option(
        session,
        material_id=payload.material_id,
        delivery_option_id=payload.delivery_option_id,
    )

    raw_delivery_rate = delivery_option.delivery_rate_per_km
    delivery_rate_per_km = round(float(raw_delivery_rate), 2) if raw_delivery_rate is not None else 0.0
    delivery_rate_snapshot = delivery_rate_per_km if raw_delivery_rate is not None else None
    route_calculated_at: datetime | None = None
    resolved_pickup_address = payload.pickup_address
    resolved_pickup_lat = payload.pickup_lat
    resolved_pickup_lon = payload.pickup_lon
    resolved_delivery_lat = payload.delivery_lat
    resolved_delivery_lon = payload.delivery_lon
    resolved_quarry_id = payload.quarry_id
    resolved_mileage_km = round(payload.mileage_km, 2) if payload.mileage_km is not None else None
    resolved_delivery_cost = 0.0
    resolved_calculation_source: str | None = None

    if payload.calculation_source == "manual":
        resolved_calculation_source = "manual"
        if resolved_pickup_lat is None or resolved_pickup_lon is None:
            selected_quarry = await _resolve_logist_order_quarry(
                session,
                material_id=payload.material_id,
                pickup_address=payload.pickup_address,
            )
            if selected_quarry is not None:
                resolved_pickup_address = selected_quarry.address
                resolved_pickup_lat = selected_quarry.lat
                resolved_pickup_lon = selected_quarry.lon
                resolved_quarry_id = selected_quarry.id

        if resolved_mileage_km is not None and raw_delivery_rate is not None:
            resolved_delivery_cost = max(
                round(resolved_mileage_km * delivery_rate_per_km, 2),
                resolve_min_delivery_price(delivery_option),
            )
    elif resolved_delivery_lat is not None and resolved_delivery_lon is not None:
        pricing = await calculate_client_order_pricing(
            session,
            material_id=payload.material_id,
            delivery_option_id=payload.delivery_option_id,
            delivery_lat=resolved_delivery_lat,
            delivery_lon=resolved_delivery_lon,
            quantity=payload.quantity,
            quarry_id=resolved_quarry_id,
        )
        selected_quarry = pricing.quarry
        resolved_pickup_address = selected_quarry.address or selected_quarry.name
        resolved_pickup_lat = selected_quarry.lat
        resolved_pickup_lon = selected_quarry.lon
        resolved_quarry_id = selected_quarry.id
        resolved_mileage_km = pricing.mileage_km
        resolved_delivery_cost = pricing.delivery_cost
        resolved_calculation_source = payload.calculation_source
        route_calculated_at = utcnow()

    order = await build_order(
        session,
        client=client,
        material=material,
        delivery_option=delivery_option,
        address=payload.delivery_address,
        notes=payload.notes,
        source=payload.source or "dispatcher",
        created_by_source="dispatcher",
        quantity=payload.quantity,
        auto_dispatch=payload.auto_dispatch,
        pickup_address=resolved_pickup_address,
        pickup_lat=resolved_pickup_lat,
        pickup_lon=resolved_pickup_lon,
        quarry_id=resolved_quarry_id,
        delivery_address=payload.delivery_address,
        delivery_lat=resolved_delivery_lat,
        delivery_lon=resolved_delivery_lon,
        mileage_km=resolved_mileage_km,
        delivery_rate_per_km_snapshot=delivery_rate_snapshot,
        delivery_cost=resolved_delivery_cost,
        calculation_source=resolved_calculation_source,
        route_calculated_at=route_calculated_at,
    )
    await session.commit()
    schedule_client_order_created_notification(order)
    if payload.auto_dispatch:
        await enqueue_order_for_dispatch_safe(order.id)
    return await get_order_by_id(session, order.id)


async def assign_order_to_driver_manually(session: AsyncSession, *, order_id: UUID, driver_id: UUID) -> Order:
    order = await get_order_by_id(session, order_id)
    allowed_statuses = {
        OrderStatus.created.value,
        OrderStatus.searching_driver.value,
        OrderStatus.offered_to_driver.value,
        OrderStatus.no_driver_found.value,
    }
    if order.status not in allowed_statuses:
        if order.status == OrderStatus.driver_assigned.value and order.driver_id == driver_id:
            return order
        raise HTTPException(status_code=409, detail="Order cannot be manually assigned in its current status")

    result = await session.execute(
        select(Driver)
        .options(selectinload(Driver.vehicle).selectinload(Vehicle.delivery_option))
        .where(Driver.id == driver_id)
    )
    driver = result.scalar_one_or_none()
    if driver is None:
        raise HTTPException(status_code=404, detail="Driver not found")
    if driver.moderation_status not in DISPATCH_ALLOWED_MODERATION_STATUSES:
        raise HTTPException(status_code=400, detail=MANUAL_ASSIGN_APPROVAL_ERROR)
    if driver.status != DriverStatus.available.value:
        raise HTTPException(status_code=409, detail="Driver is not available")
    if driver.vehicle is None or not driver.vehicle.is_active:
        raise HTTPException(status_code=409, detail="Driver has no active vehicle")
    if driver.vehicle.moderation_status not in DISPATCH_ALLOWED_MODERATION_STATUSES:
        raise HTTPException(status_code=400, detail=MANUAL_ASSIGN_APPROVAL_ERROR)
    ensure_driver_vehicle_matches_order_volume(order, driver)

    now = utcnow()
    pending_offers = await session.scalars(
        select(OrderOffer).where(
            OrderOffer.order_id == order.id,
            OrderOffer.status == OrderOfferStatus.pending.value,
        )
    )
    for offer in pending_offers:
        offer.status = OrderOfferStatus.cancelled.value
        offer.responded_at = now
        offer.decision_reason = "Manual assignment by logist"

    next_sequence_no = (
        await session.scalar(
            select(func.coalesce(func.max(OrderOffer.sequence_no), 0)).where(OrderOffer.order_id == order.id)
        )
    ) or 0
    accepted_offer = OrderOffer(
        order_id=order.id,
        driver_id=driver.id,
        price=order.total_amount,
        sequence_no=next_sequence_no + 1,
        status=OrderOfferStatus.accepted.value,
        offered_at=now,
        expires_at=now,
        responded_at=now,
        decision_reason="Manual assignment by logist",
        priority_snapshot={"manual_assignment": True},
    )
    session.add(accepted_offer)
    await session.flush()

    order.driver_id = driver.id
    order.driver = driver
    order.status = OrderStatus.driver_assigned.value
    order.assigned_at = now
    order.current_offer_id = accepted_offer.id
    if order.dispatch_started_at is None:
        order.dispatch_started_at = now

    driver.status = DriverStatus.busy.value

    await add_event(session, order.id, "driver_assigned_manual", f"Driver {driver_id} assigned manually")
    await session.commit()
    refreshed_order = await get_order_by_id(session, order.id)
    schedule_client_driver_assigned_notification(refreshed_order)
    schedule_driver_new_order_notification(refreshed_order, driver.id)
    return refreshed_order


def hydrate_order_route_fields(order: Order | None) -> Order | None:
    if order is None:
        return None

    quarry = getattr(order, "quarry", None)
    if quarry is not None:
        if not order.pickup_address:
            order.pickup_address = quarry.address or quarry.name
        if order.pickup_lat is None:
            order.pickup_lat = quarry.lat
        if order.pickup_lon is None:
            order.pickup_lon = quarry.lon

    if not order.delivery_address and order.address:
        order.delivery_address = order.address

    return order


def hydrate_orders_route_fields(orders: list[Order]) -> list[Order]:
    for order in orders:
        hydrate_order_route_fields(order)
    return orders


def order_load_options() -> tuple:
    return (
        selectinload(Order.client),
        selectinload(Order.driver).selectinload(Driver.vehicle).selectinload(Vehicle.delivery_option),
        selectinload(Order.delivery_option),
        selectinload(Order.quarry),
        selectinload(Order.items).selectinload(OrderItem.material),
        selectinload(Order.current_offer),
        selectinload(Order.offers).selectinload(OrderOffer.driver).selectinload(Driver.vehicle),
    )


async def get_order_by_id(
    session: AsyncSession,
    order_id: UUID,
    *,
    include_deleted: bool = False,
) -> Order:
    stmt = select(Order).options(*order_load_options()).where(Order.id == order_id)
    if not include_deleted:
        stmt = stmt.where(active_order_clause())
    result = await session.execute(stmt)
    order = result.scalar_one_or_none()
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return hydrate_order_route_fields(order)


async def list_recent_orders(
    session: AsyncSession,
    limit: int = 20,
    *,
    driver_id: UUID | None = None,
    created_on: date | None = None,
    is_deleted: bool = False,
) -> list[Order]:
    stmt = select(Order).options(*order_load_options())
    stmt = stmt.where(Order.is_deleted.is_(is_deleted))

    if driver_id is not None:
        stmt = stmt.where(Order.driver_id == driver_id)

    if created_on is not None:
        day_start = datetime.combine(created_on, time.min, tzinfo=UTC)
        next_day_start = day_start + timedelta(days=1)
        stmt = stmt.where(Order.created_at >= day_start).where(Order.created_at < next_day_start)

    result = await session.execute(stmt.order_by(Order.created_at.desc()).limit(limit))
    return hydrate_orders_route_fields(list(result.scalars().unique().all()))


async def update_order_by_logist(
    session: AsyncSession,
    *,
    order_id: UUID,
    payload,
) -> Order:
    order = await get_order_by_id(session, order_id)
    provided_fields = set(payload.model_fields_set)
    restricted_fields = {
        "material_id",
        "delivery_option_id",
        "quarry_id",
    }
    if provided_fields & restricted_fields and order.status not in FULL_ORDER_EDIT_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Material, vehicle type and quarry can be changed only for "
                "created/searching_driver/no_driver_found/timeout orders"
            ),
        )

    client = order.client
    if client is None:
        client = await session.get(Client, order.client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")

    current_item = order.items[0] if order.items else None
    if current_item is None:
        raise HTTPException(status_code=409, detail="Order items are missing")

    driver_notification_candidate = order.driver_id is not None and order.status in ACTIVE_ASSIGNED_ORDER_STATUSES
    driver_notification_snapshot_before = _driver_order_notification_snapshot(order, current_item)

    if "client_phone" in provided_fields and payload.client_phone is not None:
        normalized_phone = normalize_phone(payload.client_phone)
        if normalized_phone != client.phone:
            target_client = await session.scalar(select(Client).where(Client.phone == normalized_phone))
            if target_client is None:
                target_client = Client(
                    name=(payload.client_name or client.name or normalized_phone),
                    phone=normalized_phone,
                )
                session.add(target_client)
                await session.flush()
            elif "client_name" in provided_fields and payload.client_name:
                target_client.name = payload.client_name
                await session.flush()

            order.client_id = target_client.id
            order.client = target_client
            client = target_client

    if "client_name" in provided_fields and payload.client_name is not None:
        client.name = payload.client_name

    if "notes" in provided_fields:
        order.notes = payload.notes

    if "delivery_address" in provided_fields and payload.delivery_address is not None:
        order.delivery_address = payload.delivery_address
        order.address = payload.delivery_address

    if "delivery_lat" in provided_fields and payload.delivery_lat is not None:
        order.delivery_lat = payload.delivery_lat

    if "delivery_lon" in provided_fields and payload.delivery_lon is not None:
        order.delivery_lon = payload.delivery_lon

    if {"delivery_lat", "delivery_lon"} & provided_fields:
        order.route_calculated_at = utcnow()

    if "quarry_id" in provided_fields and payload.quarry_id is not None:
        quarry = await session.get(Quarry, payload.quarry_id)
        if quarry is None or not quarry.is_active:
            raise HTTPException(status_code=404, detail="Quarry not found")
        order.quarry_id = quarry.id
        order.quarry = quarry
        order.pickup_address = quarry.address or quarry.name
        order.pickup_lat = quarry.lat
        order.pickup_lon = quarry.lon

    next_material = current_item.material
    if next_material is None:
        next_material = await session.get(Material, current_item.material_id)
    if next_material is None:
        raise HTTPException(status_code=404, detail="Material not found")

    if "material_id" in provided_fields and payload.material_id is not None:
        next_material = await session.get(Material, payload.material_id)
        if next_material is None or not next_material.is_active:
            raise HTTPException(status_code=404, detail="Material not found")

    next_delivery_option = order.delivery_option
    if next_delivery_option is None and order.delivery_option_id is not None:
        next_delivery_option = await session.get(DeliveryOption, order.delivery_option_id)
    if next_delivery_option is None:
        raise HTTPException(status_code=404, detail="Delivery option not found")

    if "delivery_option_id" in provided_fields and payload.delivery_option_id is not None:
        next_delivery_option = await session.get(DeliveryOption, payload.delivery_option_id)
        if next_delivery_option is None or not next_delivery_option.is_active:
            raise HTTPException(status_code=404, detail="Delivery option not found")

    if provided_fields & {"material_id", "delivery_option_id"}:
        quantity = max(current_item.quantity or 1, 1)
        volume = next_delivery_option.capacity_m3 * quantity
        unit_price = next_material.price
        amount = volume * unit_price if unit_price is not None else None

        order.delivery_option_id = next_delivery_option.id
        order.delivery_option = next_delivery_option
        current_item.material_id = next_material.id
        current_item.material = next_material
        current_item.volume = volume
        current_item.price = unit_price
        current_item.amount = amount
        order.total_amount = round(amount or 0.0, 2)

    if "total_amount" in provided_fields and payload.total_amount is not None:
        order.total_amount = round(payload.total_amount, 2)
        current_item.amount = order.total_amount
        if current_item.volume and current_item.volume > 0:
            current_item.price = round(order.total_amount / current_item.volume, 2)

    if "delivery_cost" in provided_fields and payload.delivery_cost is not None:
        order.delivery_cost = round(payload.delivery_cost, 2)

    driver_notification_snapshot_after = _driver_order_notification_snapshot(order, current_item)
    driver_visible_details_changed = (
        driver_notification_candidate and driver_notification_snapshot_before != driver_notification_snapshot_after
    )

    await add_event(session, order.id, "order_updated_by_logist", "Order updated by logist", order_status=order.status)
    await session.commit()
    refreshed_order = await get_order_by_id(session, order.id)
    if (
        driver_visible_details_changed
        and refreshed_order.driver_id is not None
        and refreshed_order.status in ACTIVE_ASSIGNED_ORDER_STATUSES
    ):
        schedule_driver_order_changed_notification(refreshed_order, refreshed_order.driver_id)
    return refreshed_order


async def list_orders_for_client(session: AsyncSession, client_id: UUID) -> list[Order]:
    result = await session.execute(
        select(Order)
        .options(*order_load_options())
        .where(Order.client_id == client_id, active_order_clause())
        .order_by(Order.created_at.desc())
    )
    return hydrate_orders_route_fields(list(result.scalars().unique().all()))


async def delete_order_by_id(session: AsyncSession, order_id: UUID) -> None:
    order = await session.get(Order, order_id)
    if order is None or order.is_deleted:
        raise HTTPException(status_code=404, detail="Order not found")

    order.is_deleted = True
    order.status = OrderStatus.cancelled.value
    order.current_offer_id = None
    await session.execute(
        update(OrderOffer)
        .where(OrderOffer.order_id == order_id)
        .values(status=OrderOfferStatus.cancelled.value)
    )
    await session.commit()


def _matching_drivers_base_query(order: Order) -> Select[tuple[Driver]]:
    requested_volume = get_order_requested_volume(order)
    return (
        select(Driver)
        .join(Driver.vehicle)
        .options(selectinload(Driver.vehicle).selectinload(Vehicle.delivery_option))
        .where(Driver.status == DriverStatus.available.value)
        .where(Driver.moderation_status.in_(DISPATCH_ALLOWED_MODERATION_STATUSES))
        .where(Driver.is_auto_dispatch_enabled.is_(True))
        .where(Driver.vehicle_id.is_not(None))
        .where(Vehicle.is_active.is_(True))
        .where(Vehicle.moderation_status.in_(DISPATCH_ALLOWED_MODERATION_STATUSES))
        .where(build_vehicle_volume_match_clause(requested_volume))
    )


async def _current_cycle_offer_driver_ids(
    session: AsyncSession,
    order: Order,
    *,
    statuses: tuple[str, ...] | None = None,
) -> set[UUID]:
    stmt = select(OrderOffer.driver_id).where(OrderOffer.order_id == order.id)
    if order.dispatch_started_at is not None:
        stmt = stmt.where(OrderOffer.offered_at >= order.dispatch_started_at)
    if statuses:
        stmt = stmt.where(OrderOffer.status.in_(statuses))
    rows = await session.scalars(stmt)
    return {driver_id for driver_id in rows.all() if driver_id is not None}


async def _log_dispatch_candidates(
    session: AsyncSession,
    order: Order,
    *,
    excluded_driver_ids: set[UUID],
    exclude_attempted_drivers: bool,
) -> None:
    requested_volume = get_order_requested_volume(order)
    result = await session.execute(
        select(Driver)
        .options(selectinload(Driver.vehicle).selectinload(Vehicle.delivery_option))
        .where(Driver.vehicle_id.is_not(None))
        .order_by(Driver.dispatch_priority.desc(), Driver.id.asc())
    )
    drivers = list(result.scalars().all())
    attempted_ids: set[UUID] = set()
    rejected_ids: set[UUID] = set()
    if order.dispatch_started_at is not None:
        attempted_rows = await session.execute(
            select(OrderOffer.driver_id, OrderOffer.status)
            .where(OrderOffer.order_id == order.id, OrderOffer.offered_at >= order.dispatch_started_at)
        )
        for driver_id, offer_status in attempted_rows.all():
            attempted_ids.add(driver_id)
            if offer_status in {OrderOfferStatus.declined.value, OrderOfferStatus.expired.value}:
                rejected_ids.add(driver_id)

    candidate_logs: list[dict[str, object]] = []
    for driver in drivers:
        vehicle = driver.vehicle
        reasons: list[str] = []
        if driver.status != DriverStatus.available.value:
            reasons.append(f'status={driver.status}')
        if driver.moderation_status not in DISPATCH_ALLOWED_MODERATION_STATUSES:
            reasons.append(f'driver_moderation={driver.moderation_status}')
        if not driver.is_auto_dispatch_enabled:
            reasons.append('auto_dispatch_disabled')
        if vehicle is None:
            reasons.append('vehicle_missing')
        else:
            if not vehicle.is_active:
                reasons.append('vehicle_inactive')
            if vehicle.moderation_status not in DISPATCH_ALLOWED_MODERATION_STATUSES:
                reasons.append(f'vehicle_moderation={vehicle.moderation_status}')
            if requested_volume is not None and requested_volume > 0:
                cubature_min = vehicle.cubature_min
                cubature_max = vehicle.cubature_max
                body_volume = vehicle.body_volume_m3
                if cubature_min is not None and requested_volume < cubature_min:
                    reasons.append(f'volume_lt_min:{requested_volume}<{cubature_min}')
                if cubature_max is not None and requested_volume > cubature_max:
                    reasons.append(f'volume_gt_max:{requested_volume}>{cubature_max}')
                if body_volume is not None and requested_volume > body_volume:
                    reasons.append(f'volume_gt_body:{requested_volume}>{body_volume}')
        if driver.id in rejected_ids:
            reasons.append('already_rejected_or_expired')
        if exclude_attempted_drivers and driver.id in attempted_ids:
            reasons.append('already_attempted')
        if driver.id in excluded_driver_ids:
            reasons.append('explicitly_excluded')
        if driver.temporary_penalty_until and driver.temporary_penalty_until > utcnow():
            reasons.append(f'penalty_until={driver.temporary_penalty_until.isoformat()}')

        candidate_logs.append(
            {
                'driver_id': str(driver.id),
                'driver_name': driver.name,
                'status': driver.status,
                'priority': driver.dispatch_priority,
                'vehicle_id': str(driver.vehicle_id) if driver.vehicle_id else None,
                'delivery_option_id': str(vehicle.delivery_option_id) if vehicle and vehicle.delivery_option_id else None,
                'reasons': reasons or ['eligible'],
            }
        )

    logger.info(
        'dispatch_candidate_scan',
        extra={
            'order_id': str(order.id),
            'requested_volume': requested_volume,
            'drivers_total': len(candidate_logs),
            'drivers_snapshot': candidate_logs,
        },
    )


async def get_matching_drivers(
    session: AsyncSession,
    order: Order,
    *,
    exclude_attempted_drivers: bool = True,
    allow_attempted_fallback: bool = False,
    excluded_driver_ids: set[UUID] | None = None,
) -> list[Driver]:
    now = utcnow()
    excluded_driver_ids = excluded_driver_ids or set()
    await _log_dispatch_candidates(
        session,
        order,
        excluded_driver_ids=excluded_driver_ids,
        exclude_attempted_drivers=exclude_attempted_drivers,
    )
    attempted_driver_ids = await _current_cycle_offer_driver_ids(session, order)
    rejected_driver_ids = await _current_cycle_offer_driver_ids(
        session,
        order,
        statuses=(OrderOfferStatus.declined.value, OrderOfferStatus.expired.value),
    )

    preferred_stmt = _matching_drivers_base_query(order).where(
        or_(
            Driver.temporary_penalty_until.is_(None),
            Driver.temporary_penalty_until <= now,
        )
    )
    fallback_stmt = _matching_drivers_base_query(order)

    if rejected_driver_ids:
        preferred_stmt = preferred_stmt.where(Driver.id.not_in(rejected_driver_ids))
        fallback_stmt = fallback_stmt.where(Driver.id.not_in(rejected_driver_ids))

    if exclude_attempted_drivers and attempted_driver_ids:
        preferred_stmt = preferred_stmt.where(Driver.id.not_in(attempted_driver_ids))
        fallback_stmt = fallback_stmt.where(Driver.id.not_in(attempted_driver_ids))

    if excluded_driver_ids:
        preferred_stmt = preferred_stmt.where(Driver.id.not_in(excluded_driver_ids))
        fallback_stmt = fallback_stmt.where(Driver.id.not_in(excluded_driver_ids))

    preferred_stmt = preferred_stmt.order_by(
        Driver.dispatch_priority.desc(),
        Driver.last_offer_at.asc().nullsfirst(),
        Driver.id.asc(),
    )
    fallback_stmt = fallback_stmt.order_by(
        Driver.dispatch_priority.desc(),
        Driver.temporary_penalty_until.asc().nullslast(),
        Driver.last_offer_at.asc().nullsfirst(),
        Driver.id.asc(),
    )

    preferred_result = await session.execute(preferred_stmt)
    preferred = list(preferred_result.scalars().all())
    if preferred:
        logger.info(
            'dispatch_candidates_selected',
            extra={
                'order_id': str(order.id),
                'stage': 'preferred',
                'count': len(preferred),
                'driver_ids': [str(driver.id) for driver in preferred],
            },
        )
        return preferred

    fallback_result = await session.execute(fallback_stmt)
    fallback = list(fallback_result.scalars().all())
    if fallback:
        logger.info(
            'dispatch_candidates_selected',
            extra={
                'order_id': str(order.id),
                'stage': 'fallback',
                'count': len(fallback),
                'driver_ids': [str(driver.id) for driver in fallback],
            },
        )
        return fallback

    logger.info(
        'dispatch_candidates_selected',
        extra={
            'order_id': str(order.id),
            'stage': 'none',
            'count': 0,
            'driver_ids': [],
            'note': 'no eligible drivers after attempted/rejected/penalty filters',
        },
    )
    return []


async def create_offer_for_driver(session: AsyncSession, order: Order, driver: Driver) -> OrderOffer:
    now = utcnow()
    next_sequence_no = (
        await session.scalar(select(func.coalesce(func.max(OrderOffer.sequence_no), 0)).where(OrderOffer.order_id == order.id))
    ) or 0
    offer = OrderOffer(
        order_id=order.id,
        driver_id=driver.id,
        price=order.total_amount,
        sequence_no=next_sequence_no + 1,
        status=OrderOfferStatus.pending.value,
        offered_at=now,
        expires_at=now + timedelta(seconds=settings.DISPATCH_OFFER_TIMEOUT_SECONDS),
        priority_snapshot={
            "dispatch_priority": driver.dispatch_priority,
            "temporary_penalty_until": driver.temporary_penalty_until.isoformat()
            if driver.temporary_penalty_until
            else None,
        },
    )
    session.add(offer)
    await session.flush()

    order.status = OrderStatus.offered_to_driver.value
    order.current_offer_id = offer.id
    order.current_offer = offer
    driver.last_offer_at = now
    await add_event(session, order.id, "driver_offer_created", f"Offer sent to driver {driver.name}")
    return offer


async def mark_no_driver_found(session: AsyncSession, order: Order) -> Order:
    order.status = OrderStatus.no_driver_found.value
    order.current_offer_id = None
    await add_event(session, order.id, "no_driver_found", "No suitable drivers found")
    schedule_logist_no_driver_found_notification(order)
    return order


async def advance_dispatch_for_order(
    session: AsyncSession,
    order_id: UUID,
    *,
    exclude_attempted_drivers: bool = True,
    allow_attempted_fallback: bool = False,
    excluded_driver_ids: set[UUID] | None = None,
) -> Order:
    order = await get_order_by_id(session, order_id)
    terminal_or_active_statuses = ACTIVE_ASSIGNED_ORDER_STATUSES | {
        OrderStatus.completed.value,
        OrderStatus.cancelled.value,
    }
    if order.driver_id is not None or order.status in terminal_or_active_statuses:
        return order

    pending_offer = order.current_offer
    if pending_offer is not None and pending_offer.status == OrderOfferStatus.pending.value:
        if pending_offer.expires_at and pending_offer.expires_at > utcnow():
            return order

    candidates = await get_matching_drivers(
        session,
        order,
        exclude_attempted_drivers=exclude_attempted_drivers,
        allow_attempted_fallback=allow_attempted_fallback,
        excluded_driver_ids=excluded_driver_ids,
    )
    if not candidates:
        return await mark_no_driver_found(session, order)

    await create_offer_for_driver(session, order, candidates[0])
    return order


async def expire_offer(session: AsyncSession, offer: OrderOffer) -> Order:
    if offer.status != OrderOfferStatus.pending.value:
        return await get_order_by_id(session, offer.order_id)

    now = utcnow()
    offer.status = OrderOfferStatus.expired.value
    offer.responded_at = now
    offer.decision_reason = "Driver response timeout"

    driver = offer.driver
    if driver is None:
        driver = await session.get(Driver, offer.driver_id)
    if driver is not None:
        driver.temporary_penalty_until = now + timedelta(seconds=settings.DISPATCH_TIMEOUT_PENALTY_SECONDS)

    order = offer.order
    if order is None:
        order = await get_order_by_id(session, offer.order_id)
    order.current_offer_id = None
    order.status = OrderStatus.searching_driver.value
    await add_event(session, order.id, "driver_offer_expired", f"Driver {offer.driver_id} did not respond")
    schedule_logist_timeout_notification(order, offer.driver_id)
    return await advance_dispatch_for_order(
        session,
        order.id,
        allow_attempted_fallback=True,
        excluded_driver_ids={offer.driver_id},
    )


async def accept_offer(session: AsyncSession, *, offer_id: UUID, driver_id: UUID) -> Order:
    result = await session.execute(
        select(OrderOffer)
        .options(
            selectinload(OrderOffer.order).selectinload(Order.items).selectinload(OrderItem.material),
            selectinload(OrderOffer.order).selectinload(Order.client),
            selectinload(OrderOffer.order).selectinload(Order.delivery_option),
            selectinload(OrderOffer.order).selectinload(Order.quarry),
            selectinload(OrderOffer.driver).selectinload(Driver.vehicle).selectinload(Vehicle.delivery_option),
        )
        .where(OrderOffer.id == offer_id)
    )
    offer = result.scalar_one_or_none()
    if offer is None:
        raise HTTPException(status_code=404, detail="Offer not found")
    if offer.driver_id != driver_id:
        raise HTTPException(status_code=403, detail="Offer does not belong to this driver")
    if offer.status != OrderOfferStatus.pending.value:
        raise HTTPException(status_code=409, detail="Offer is no longer pending")

    order = offer.order
    if order.driver_id is not None and order.driver_id != driver_id:
        raise HTTPException(status_code=409, detail="Order is already assigned")

    now = utcnow()
    offer.status = OrderOfferStatus.accepted.value
    offer.responded_at = now

    order.driver_id = driver_id
    order.status = OrderStatus.driver_assigned.value
    order.assigned_at = now
    order.current_offer_id = offer.id

    driver = offer.driver
    if driver is None:
        driver = await session.get(Driver, driver_id)
    if driver is not None:
        ensure_driver_vehicle_matches_order_volume(order, driver)
        driver.status = DriverStatus.busy.value

    await session.execute(
        select(OrderOffer).where(
            OrderOffer.order_id == order.id,
            OrderOffer.id != offer.id,
            OrderOffer.status == OrderOfferStatus.pending.value,
        )
    )
    others = await session.scalars(
        select(OrderOffer).where(
            OrderOffer.order_id == order.id,
            OrderOffer.id != offer.id,
            OrderOffer.status == OrderOfferStatus.pending.value,
        )
    )
    for other_offer in others:
        other_offer.status = OrderOfferStatus.cancelled.value
        other_offer.responded_at = now
        other_offer.decision_reason = "Order accepted by another driver"

    await add_event(session, order.id, "driver_assigned", f"Driver {driver_id} accepted the order")
    await session.commit()
    refreshed_order = await get_order_by_id(session, order.id)
    schedule_client_driver_assigned_notification(refreshed_order)
    return refreshed_order


async def decline_offer(session: AsyncSession, *, offer_id: UUID, driver_id: UUID, reason: str | None) -> Order:
    result = await session.execute(
        select(OrderOffer)
        .options(
            selectinload(OrderOffer.order).selectinload(Order.items).selectinload(OrderItem.material),
            selectinload(OrderOffer.order).selectinload(Order.client),
            selectinload(OrderOffer.order).selectinload(Order.delivery_option),
            selectinload(OrderOffer.order).selectinload(Order.quarry),
            selectinload(OrderOffer.driver).selectinload(Driver.vehicle).selectinload(Vehicle.delivery_option),
        )
        .where(OrderOffer.id == offer_id)
    )
    offer = result.scalar_one_or_none()
    if offer is None:
        raise HTTPException(status_code=404, detail="Offer not found")
    if offer.driver_id != driver_id:
        raise HTTPException(status_code=403, detail="Offer does not belong to this driver")
    if offer.status != OrderOfferStatus.pending.value:
        raise HTTPException(status_code=409, detail="Offer is no longer pending")

    now = utcnow()
    offer.status = OrderOfferStatus.declined.value
    offer.responded_at = now
    offer.decision_reason = reason

    driver = offer.driver
    if driver is None:
        driver = await session.get(Driver, driver_id)
    driver_name = driver.name if driver is not None and driver.name else None
    if driver is not None:
        driver.temporary_penalty_until = now + timedelta(seconds=settings.DISPATCH_DECLINE_PENALTY_SECONDS)

    order = offer.order
    if order is None:
        order = await get_order_by_id(session, offer.order_id)
    order.current_offer_id = None
    order.status = OrderStatus.searching_driver.value
    await add_event(session, order.id, "driver_declined", f"Driver {driver_id} declined the order")

    order = await advance_dispatch_for_order(
        session,
        order.id,
        allow_attempted_fallback=True,
        excluded_driver_ids={driver_id},
    )
    await session.commit()
    refreshed_order = await get_order_by_id(session, order.id)
    schedule_logist_driver_rejected_notification(refreshed_order, driver_id, driver_name)
    if refreshed_order.status == OrderStatus.offered_to_driver.value:
        schedule_new_order_push(
            refreshed_order,
            refreshed_order.current_offer.driver_id if refreshed_order.current_offer is not None else None,
        )
    return refreshed_order


async def cancel_driver_assigned_order(
    session: AsyncSession,
    *,
    order_id: UUID,
    driver_id: UUID,
    reason: str,
) -> Order:
    order = await get_order_by_id(session, order_id)
    if order.driver_id != driver_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Order does not belong to this driver")
    if order.status not in {OrderStatus.driver_assigned.value, OrderStatus.driver_accepted.value}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Order cannot be cancelled in its current status")

    now = utcnow()
    current_offer = order.current_offer
    if current_offer is None:
        next_sequence_no = (
            await session.scalar(
                select(func.coalesce(func.max(OrderOffer.sequence_no), 0)).where(OrderOffer.order_id == order.id)
            )
        ) or 0
        current_offer = OrderOffer(
            order_id=order.id,
            driver_id=driver_id,
            price=order.total_amount,
            sequence_no=next_sequence_no + 1,
            status=OrderOfferStatus.declined.value,
            offered_at=order.assigned_at or order.dispatch_started_at or order.created_at or now,
            expires_at=now,
            responded_at=now,
            decision_reason=reason,
            priority_snapshot={"driver_cancelled_after_accept": True},
        )
        session.add(current_offer)
        await session.flush()
    else:
        current_offer.status = OrderOfferStatus.declined.value
        current_offer.responded_at = now
        current_offer.decision_reason = reason

    driver = order.driver
    if driver is None:
        driver = await session.get(Driver, driver_id)
    driver_name = driver.name if driver is not None and driver.name else None
    if driver is not None:
        driver.status = DriverStatus.available.value

    order.driver_id = None
    order.driver = None
    order.assigned_at = None
    order.current_offer_id = None
    order.current_offer = None
    order.status = OrderStatus.searching_driver.value

    await add_event(
        session,
        order.id,
        "driver_cancelled_assigned_order",
        f"Driver {driver_id} cancelled the order. Reason: {reason}",
        order_status=order.status,
    )
    await session.commit()
    schedule_logist_driver_rejected_notification(order, driver_id, driver_name)
    await enqueue_order_for_dispatch_safe(order.id)
    return await get_order_by_id(session, order.id)


def _driver_order_status_event(target_status: str, driver_id: UUID) -> tuple[str, str]:
    event_map = {
        OrderStatus.driver_accepted.value: (
            "driver_accepted_order",
            f"Driver {driver_id} accepted assigned order",
        ),
        OrderStatus.heading_to_pickup.value: (
            "driver_heading_to_pickup",
            f"Driver {driver_id} is heading to pickup",
        ),
        OrderStatus.arrived_at_pickup.value: (
            "driver_arrived_at_pickup",
            f"Driver {driver_id} arrived at pickup",
        ),
        OrderStatus.loading.value: (
            "driver_loading",
            f"Driver {driver_id} started loading",
        ),
        OrderStatus.heading_to_client.value: (
            "driver_heading_to_client",
            f"Driver {driver_id} is heading to client",
        ),
        OrderStatus.delivered.value: (
            "driver_delivered_order",
            f"Driver {driver_id} delivered the order",
        ),
        OrderStatus.completed.value: (
            "driver_completed_order",
            f"Driver {driver_id} completed the order",
        ),
    }
    return event_map[target_status]


async def set_driver_order_status(
    session: AsyncSession,
    *,
    order_id: UUID,
    driver_id: UUID,
    target_status: str,
) -> Order:
    order = await get_order_by_id(session, order_id)
    if order.driver_id != driver_id:
        raise HTTPException(status_code=403, detail="Order does not belong to this driver")

    if order.status == target_status:
        return order

    allowed_statuses = DRIVER_ORDER_STATUS_TRANSITIONS.get(order.status, set())
    if target_status not in allowed_statuses:
        raise HTTPException(status_code=409, detail="Order status transition is not allowed")

    driver = order.driver
    if driver is None:
        driver = await session.get(Driver, driver_id)
    if driver is None:
        raise HTTPException(status_code=404, detail="Driver not found")

    order.status = target_status
    if target_status == OrderStatus.completed.value:
        order.current_offer_id = None
        driver.status = DriverStatus.available.value
    else:
        driver.status = DriverStatus.busy.value

    event_type, event_description = _driver_order_status_event(target_status, driver_id)
    await add_event(session, order.id, event_type, event_description, order_status=order.status)
    await session.commit()

    refreshed_order = await get_order_by_id(session, order.id)
    if target_status == OrderStatus.heading_to_client.value:
        schedule_client_heading_to_client_notification(refreshed_order)
    if target_status == OrderStatus.completed.value:
        schedule_client_order_completed_notification(refreshed_order)
    return refreshed_order


async def restart_dispatch_for_order(session: AsyncSession, order_id: UUID) -> Order:
    order = await get_order_by_id(session, order_id)
    if order.status in ACTIVE_ASSIGNED_ORDER_STATUSES | {
        OrderStatus.completed.value,
        OrderStatus.cancelled.value,
    }:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Order cannot be redispatched")

    now = utcnow()
    current_offer = order.current_offer
    if current_offer is not None and current_offer.status == OrderOfferStatus.pending.value:
        current_offer.status = OrderOfferStatus.cancelled.value
        current_offer.responded_at = now
        current_offer.decision_reason = "Dispatch restarted by logist"

    await session.execute(
        update(OrderOffer)
        .where(
            OrderOffer.order_id == order.id,
            OrderOffer.status == OrderOfferStatus.pending.value,
        )
        .values(
            status=OrderOfferStatus.cancelled.value,
            responded_at=now,
            decision_reason="Dispatch restarted by logist",
        )
    )

    order.driver_id = None
    order.assigned_at = None
    order.current_offer_id = None
    order.status = OrderStatus.searching_driver.value
    order.dispatch_started_at = now
    await add_event(session, order.id, "dispatch_started", "Dispatch restarted by logist")
    await session.commit()

    await enqueue_order_for_dispatch_safe(order.id)
    return await get_order_by_id(session, order.id)


async def get_current_incoming_offer_for_driver(session: AsyncSession, driver_id: UUID) -> OrderOffer | None:
    now = utcnow()
    result = await session.execute(
        select(OrderOffer)
        .options(
            selectinload(OrderOffer.order).selectinload(Order.items).selectinload(OrderItem.material),
            selectinload(OrderOffer.order).selectinload(Order.client),
            selectinload(OrderOffer.order).selectinload(Order.delivery_option),
            selectinload(OrderOffer.order).selectinload(Order.quarry),
        )
        .where(OrderOffer.driver_id == driver_id)
        .where(OrderOffer.status == OrderOfferStatus.pending.value)
        .where(or_(OrderOffer.expires_at.is_(None), OrderOffer.expires_at > now))
        .order_by(OrderOffer.offered_at.desc())
        .limit(1)
    )
    offer = result.scalar_one_or_none()
    if offer is not None and offer.order is not None:
        hydrate_order_route_fields(offer.order)
    return offer


async def get_current_assigned_order_for_driver(session: AsyncSession, driver_id: UUID) -> Order | None:
    result = await session.execute(
        select(Order)
        .options(*order_load_options())
        .where(Order.driver_id == driver_id)
        .where(Order.status.in_(sorted(ACTIVE_ASSIGNED_ORDER_STATUSES)))
        .order_by(Order.assigned_at.desc().nullslast(), Order.created_at.desc())
        .limit(1)
    )
    order = result.scalar_one_or_none()
    return hydrate_order_route_fields(order)


async def list_orders_for_driver(session: AsyncSession, driver_id: UUID, limit: int = 50) -> list[Order]:
    result = await session.execute(
        select(Order)
        .options(*order_load_options())
        .where(Order.driver_id == driver_id)
        .order_by(Order.assigned_at.desc().nullslast(), Order.created_at.desc())
        .limit(limit)
    )
    return hydrate_orders_route_fields(list(result.scalars().unique().all()))


async def build_dispatch_history(session: AsyncSession, order_id: UUID) -> DispatchHistoryOut:
    order = await get_order_by_id(session, order_id, include_deleted=True)
    offers = await session.scalars(
        select(OrderOffer)
        .options(selectinload(OrderOffer.driver).selectinload(Driver.vehicle))
        .where(OrderOffer.order_id == order_id)
        .order_by(OrderOffer.sequence_no.asc())
    )
    attempts = [
        DispatchHistoryAttemptOut(
            offer_id=offer.id,
            sequence_no=offer.sequence_no,
            driver_id=offer.driver_id,
            driver_name=offer.driver.name,
            driver_phone=offer.driver.phone,
            vehicle_title=offer.driver.vehicle.title if offer.driver and offer.driver.vehicle else None,
            status=offer.status,
            offered_at=offer.offered_at,
            expires_at=offer.expires_at,
            responded_at=offer.responded_at,
            decision_reason=offer.decision_reason,
        )
        for offer in offers
    ]
    return DispatchHistoryOut(
        order_id=order.id,
        status=order.status,
        assigned_driver_id=order.driver_id,
        attempts=attempts,
    )


async def build_order_status_history(session: AsyncSession, order_id: UUID) -> OrderHistoryOut:
    order = await get_order_by_id(session, order_id, include_deleted=True)
    result = await session.execute(
        select(OrderEvent)
        .where(OrderEvent.order_id == order_id)
        .order_by(OrderEvent.created_at.asc(), OrderEvent.id.asc())
    )
    events = [
        OrderHistoryEventOut(
            id=event.id,
            status=event.status,
            event_type=event.event_type,
            description=event.description,
            created_at=event.created_at,
        )
        for event in result.scalars().all()
    ]
    return OrderHistoryOut(order_id=order.id, current_status=order.status, events=events)


async def get_orders_needing_dispatch(session: AsyncSession, limit: int = 50) -> list[UUID]:
    now = utcnow()
    result = await session.execute(
        select(Order.id)
        .outerjoin(Order.current_offer)
        .where(
            Order.is_deleted.is_(False),
            or_(
                Order.status == OrderStatus.created.value,
                Order.status == OrderStatus.searching_driver.value,
                Order.status == OrderStatus.no_driver_found.value,
                (
                    Order.status == OrderStatus.offered_to_driver.value
                )
                & (
                    or_(
                        Order.current_offer_id.is_(None),
                        OrderOffer.expires_at <= now,
                    )
                ),
            )
        )
        .order_by(Order.dispatch_started_at.asc().nullsfirst(), Order.created_at.asc())
        .limit(limit)
    )
    return [row[0] for row in result.all()]


async def process_dispatch_for_order(session: AsyncSession, order_id: UUID) -> None:
    order = await get_order_by_id(session, order_id)
    current_offer = order.current_offer
    if current_offer is not None and current_offer.status == OrderOfferStatus.pending.value:
        if current_offer.expires_at and current_offer.expires_at <= utcnow():
            order = await expire_offer(session, current_offer)
            await session.commit()
            if order.status == OrderStatus.offered_to_driver.value:
                schedule_new_order_push(order, order.current_offer.driver_id if order.current_offer is not None else None)
        return

    order = await advance_dispatch_for_order(session, order_id)
    await session.commit()
    if order.status == OrderStatus.offered_to_driver.value:
        schedule_new_order_push(order, order.current_offer.driver_id if order.current_offer is not None else None)
