from __future__ import annotations

import asyncio
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
    Quarry,
    OrderItem,
    OrderOffer,
    OrderOfferStatus,
    OrderStatus,
    Vehicle,
)
from app.schemas.order import DispatchHistoryAttemptOut, DispatchHistoryOut, LogistOrderCreate
from app.services.order_pricing import calculate_client_order_pricing, resolve_min_delivery_price
from app.services.push_service import send_push_to_driver
from app.services.redis_client import enqueue_dispatch_order

GUEST_CLIENT_PHONE = "00000000000"
GUEST_CLIENT_NAME = "Гость (Демо)"
MANUAL_ASSIGN_APPROVAL_ERROR = "Невозможно назначить заказ: профиль водителя или автомобиль не прошли модерацию"
logger = logging.getLogger(__name__)


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


def build_offer_push_message(order: Order) -> tuple[str, str]:
    material_name = get_order_material_name(order)
    volume = format_order_volume(order)
    address = get_order_delivery_address(order)
    title = f"🔥 Новый заказ: {material_name}, {volume} м³"
    body = f"📍 Адрес: {address}. Нажмите, чтобы принять!"
    return title, body


def build_manual_assign_push_message(order: Order) -> tuple[str, str]:
    material_name = get_order_material_name(order)
    volume = format_order_volume(order)
    address = get_order_delivery_address(order)
    title = "✅ Вы назначены на заказ!"
    body = f"📍 Везем {material_name} ({volume} м³) по адресу: {address}."
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
    title, body = build_offer_push_message(order)
    asyncio.create_task(
        send_push_to_driver(driver_id, title, body),
        name=f"dispatch-push-{driver_id}",
    )


async def enqueue_order_for_dispatch_safe(order_id: UUID) -> None:
    try:
        await enqueue_dispatch_order(order_id)
    except Exception:
        logger.exception("dispatch_enqueue_failed", extra={"order_id": str(order_id)})


async def add_event(session: AsyncSession, order_id: UUID, event_type: str, description: str | None = None) -> None:
    session.add(EventLog(order_id=order_id, event_type=event_type, description=description))
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
    delivery_rate_per_km = delivery_option.delivery_rate_per_km
    if delivery_rate_per_km is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Тариф доставки не настроен",
        )

    delivery_rate_per_km = round(float(delivery_rate_per_km), 2)
    route_calculated_at = utcnow()
    resolved_pickup_address = payload.pickup_address
    resolved_pickup_lat = payload.pickup_lat
    resolved_pickup_lon = payload.pickup_lon
    resolved_delivery_lat = payload.delivery_lat
    resolved_delivery_lon = payload.delivery_lon
    resolved_quarry_id = payload.quarry_id
    resolved_mileage_km = round(payload.mileage_km, 2) if payload.mileage_km is not None else None
    resolved_delivery_cost: float

    if payload.calculation_source == "manual":
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

        resolved_delivery_cost = max(
            round((resolved_mileage_km or 0) * delivery_rate_per_km, 2),
            resolve_min_delivery_price(delivery_option),
        )
    else:
        if resolved_delivery_lat is None or resolved_delivery_lon is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="delivery coordinates are required for auto calculation",
            )

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
        delivery_rate_per_km_snapshot=delivery_rate_per_km,
        delivery_cost=resolved_delivery_cost,
        calculation_source=payload.calculation_source,
        route_calculated_at=route_calculated_at,
    )
    await session.commit()
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
    if driver.moderation_status != ModerationStatus.approved.value:
        raise HTTPException(status_code=400, detail=MANUAL_ASSIGN_APPROVAL_ERROR)
    if driver.status != DriverStatus.available.value:
        raise HTTPException(status_code=409, detail="Driver is not available")
    if driver.vehicle is None or not driver.vehicle.is_active:
        raise HTTPException(status_code=409, detail="Driver has no active vehicle")
    if driver.vehicle.moderation_status != ModerationStatus.approved.value:
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
    return await get_order_by_id(session, order.id)


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


async def get_order_by_id(session: AsyncSession, order_id: UUID) -> Order:
    result = await session.execute(
        select(Order)
        .options(*order_load_options())
        .where(Order.id == order_id, active_order_clause())
    )
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
    show_deleted: bool = False,
) -> list[Order]:
    stmt = select(Order).options(*order_load_options())

    if not show_deleted:
        stmt = stmt.where(active_order_clause())

    if driver_id is not None:
        stmt = stmt.where(Order.driver_id == driver_id)

    if created_on is not None:
        day_start = datetime.combine(created_on, time.min, tzinfo=UTC)
        next_day_start = day_start + timedelta(days=1)
        stmt = stmt.where(Order.created_at >= day_start).where(Order.created_at < next_day_start)

    result = await session.execute(stmt.order_by(Order.created_at.desc()).limit(limit))
    return hydrate_orders_route_fields(list(result.scalars().unique().all()))


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
        .where(Driver.moderation_status == ModerationStatus.approved.value)
        .where(Driver.is_auto_dispatch_enabled.is_(True))
        .where(Driver.vehicle_id.is_not(None))
        .where(Vehicle.is_active.is_(True))
        .where(Vehicle.moderation_status == ModerationStatus.approved.value)
        .where(build_vehicle_volume_match_clause(requested_volume))
    )


def _current_cycle_offer_driver_ids(
    order: Order,
    *,
    statuses: tuple[str, ...] | None = None,
):
    stmt = select(OrderOffer.driver_id).where(OrderOffer.order_id == order.id)
    if order.dispatch_started_at is not None:
        stmt = stmt.where(OrderOffer.offered_at >= order.dispatch_started_at)
    if statuses:
        stmt = stmt.where(OrderOffer.status.in_(statuses))
    return stmt.scalar_subquery()


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
    attempted_driver_ids = _current_cycle_offer_driver_ids(order)
    rejected_driver_ids = _current_cycle_offer_driver_ids(
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

    preferred_stmt = preferred_stmt.where(Driver.id.not_in(rejected_driver_ids))
    fallback_stmt = fallback_stmt.where(Driver.id.not_in(rejected_driver_ids))

    if exclude_attempted_drivers:
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
        return preferred

    fallback_result = await session.execute(fallback_stmt)
    fallback = list(fallback_result.scalars().all())
    return fallback


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
    if order.driver_id is not None or order.status in {
        OrderStatus.driver_assigned.value,
        OrderStatus.heading_to_quarry.value,
        OrderStatus.heading_to_client.value,
        OrderStatus.in_progress.value,
        OrderStatus.completed.value,
        OrderStatus.cancelled.value,
    }:
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
    return await get_order_by_id(session, order.id)


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
    if order.status == OrderStatus.offered_to_driver.value:
        schedule_new_order_push(order, order.current_offer.driver_id if order.current_offer is not None else None)
    return await get_order_by_id(session, order.id)


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
    if order.status != OrderStatus.driver_assigned.value:
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
            status=OrderOfferStatus.cancelled.value,
            offered_at=order.assigned_at or order.dispatch_started_at or order.created_at or now,
            expires_at=now,
            responded_at=now,
            decision_reason=reason,
            priority_snapshot={"driver_cancelled_after_accept": True},
        )
        session.add(current_offer)
        await session.flush()
    else:
        current_offer.status = OrderOfferStatus.cancelled.value
        current_offer.responded_at = now
        current_offer.decision_reason = reason

    driver = order.driver
    if driver is None:
        driver = await session.get(Driver, driver_id)
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
    )
    await session.commit()
    await enqueue_order_for_dispatch_safe(order.id)
    return await get_order_by_id(session, order.id)


async def restart_dispatch_for_order(session: AsyncSession, order_id: UUID) -> Order:
    order = await get_order_by_id(session, order_id)
    if order.status in {
        OrderStatus.driver_assigned.value,
        OrderStatus.heading_to_quarry.value,
        OrderStatus.heading_to_client.value,
        OrderStatus.in_progress.value,
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

    order.driver_id = None
    order.assigned_at = None
    order.current_offer_id = None
    order.status = OrderStatus.searching_driver.value
    order.dispatch_started_at = now
    await add_event(session, order.id, "dispatch_started", "Dispatch restarted by logist")

    order = await advance_dispatch_for_order(session, order.id, exclude_attempted_drivers=False)
    await session.commit()
    if order.status == OrderStatus.offered_to_driver.value:
        schedule_new_order_push(order, order.current_offer.driver_id if order.current_offer is not None else None)
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
        .where(Order.status.in_([
            OrderStatus.driver_assigned.value,
            OrderStatus.heading_to_quarry.value,
            OrderStatus.heading_to_client.value,
            OrderStatus.in_progress.value,
        ]))
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
    order = await get_order_by_id(session, order_id)
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


async def get_orders_needing_dispatch(session: AsyncSession, limit: int = 50) -> list[UUID]:
    now = utcnow()
    result = await session.execute(
        select(Order.id)
        .outerjoin(Order.current_offer)
        .where(
            or_(
                Order.status == OrderStatus.searching_driver.value,
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
