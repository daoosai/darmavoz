from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import Select, and_, delete, func, or_, select, true, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.models import (
    Client,
    ClientAddress,
    DeliveryOption,
    Dialogue,
    Driver,
    DriverStatus,
    EventLog,
    Material,
    ModerationStatus,
    Order,
    OrderItem,
    OrderOffer,
    OrderOfferStatus,
    OrderStatus,
    Vehicle,
)
from app.schemas.order import DispatchHistoryAttemptOut, DispatchHistoryOut, LogistOrderCreate

GUEST_CLIENT_PHONE = "00000000000"
GUEST_CLIENT_NAME = "Гость (Демо)"
MANUAL_ASSIGN_APPROVAL_ERROR = "Невозможно назначить заказ: профиль водителя или автомобиль не прошли модерацию"


def utcnow() -> datetime:
    return datetime.now(UTC)


def mask_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    if len(phone) <= 7:
        return phone
    return f"{phone[:5]}***{phone[-4:]}"


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
    delivery_lat: float | None,
    delivery_lon: float | None,
    notes: str | None,
    source: str | None,
    created_by_source: str,
    quantity: int,
    auto_dispatch: bool,
) -> Order:
    volume = delivery_option.capacity_m3 * quantity
    unit_price = material.price
    amount = volume * unit_price if unit_price is not None else None
    now = utcnow()
    order = Order(
        client_id=client.id,
        delivery_option_id=delivery_option.id,
        address=address,
        delivery_address=address,
        delivery_lat=delivery_lat,
        delivery_lon=delivery_lon,
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
    address: str | None,
    address_id: UUID | None,
    delivery_lat: float | None,
    delivery_lon: float | None,
    notes: str | None,
    source: str | None,
    quantity: int,
) -> Order:
    if client_id is None:
        client = await get_or_create_guest_client(session)
    else:
        client = await session.get(Client, client_id)
        if client is None:
            raise HTTPException(status_code=404, detail="Client not found")

    resolved_address = address.strip() if address else None
    resolved_delivery_lat = delivery_lat
    resolved_delivery_lon = delivery_lon
    if address_id is not None:
        address_record = await session.get(ClientAddress, address_id)
        if address_record is None:
            raise HTTPException(status_code=404, detail="Client address not found")
        if address_record.client_id != client.id:
            raise HTTPException(status_code=403, detail="Address does not belong to current client")
        resolved_address = address_record.full_address
        resolved_delivery_lat = address_record.lat
        resolved_delivery_lon = address_record.lon

    if not resolved_address:
        raise HTTPException(status_code=422, detail="Delivery address is required")

    material, delivery_option = await validate_material_and_delivery_option(
        session, material_id=material_id, delivery_option_id=delivery_option_id
    )
    order = await build_order(
        session,
        client=client,
        material=material,
        delivery_option=delivery_option,
        address=resolved_address,
        delivery_lat=resolved_delivery_lat,
        delivery_lon=resolved_delivery_lon,
        notes=notes,
        source=source or "mobile",
        created_by_source="client_app",
        quantity=quantity,
        auto_dispatch=True,
    )
    await session.commit()
    return await get_order_by_id(session, order.id)


async def create_logist_order(session: AsyncSession, payload: LogistOrderCreate) -> Order:
    client = await get_or_create_client_by_phone(
        session, name=payload.client_name, phone=payload.client_phone
    )
    material, delivery_option = await validate_material_and_delivery_option(
        session,
        material_id=payload.material_id,
        delivery_option_id=payload.delivery_option_id,
    )
    order = await build_order(
        session,
        client=client,
        material=material,
        delivery_option=delivery_option,
        address=payload.address,
        delivery_lat=None,
        delivery_lon=None,
        notes=payload.notes,
        source=payload.source or "dispatcher",
        created_by_source="dispatcher",
        quantity=payload.quantity,
        auto_dispatch=payload.auto_dispatch,
    )
    await session.commit()
    return await get_order_by_id(session, order.id)


def order_load_options() -> tuple:
    return (
        selectinload(Order.client),
        selectinload(Order.driver).selectinload(Driver.vehicle).selectinload(Vehicle.delivery_option),
        selectinload(Order.delivery_option),
        selectinload(Order.items).selectinload(OrderItem.material),
        selectinload(Order.current_offer),
        selectinload(Order.offers).selectinload(OrderOffer.driver).selectinload(Driver.vehicle),
    )


async def get_order_by_id(session: AsyncSession, order_id: UUID) -> Order:
    result = await session.execute(select(Order).options(*order_load_options()).where(Order.id == order_id))
    order = result.scalar_one_or_none()
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


def get_order_requested_volume(order: Order) -> float | None:
    loaded_items = order.__dict__.get("items")
    if loaded_items:
        return max((item.volume for item in loaded_items), default=None)
    loaded_delivery_option = order.__dict__.get("delivery_option")
    if loaded_delivery_option is not None:
        return loaded_delivery_option.capacity_m3
    return None


def build_vehicle_volume_match_clause(requested_volume: float | None):
    if requested_volume is None:
        return true()
    return and_(
        or_(Vehicle.cubature_min.is_(None), Vehicle.cubature_min <= requested_volume),
        or_(Vehicle.cubature_max.is_(None), Vehicle.cubature_max >= requested_volume),
    )


def vehicle_matches_requested_volume(vehicle: Vehicle | None, requested_volume: float | None) -> bool:
    if vehicle is None or requested_volume is None:
        return False
    if vehicle.cubature_min is not None and vehicle.cubature_min > requested_volume:
        return False
    if vehicle.cubature_max is not None and vehicle.cubature_max < requested_volume:
        return False
    return True


async def list_recent_orders(session: AsyncSession, limit: int = 20) -> list[Order]:
    result = await session.execute(
        select(Order).options(*order_load_options()).order_by(Order.created_at.desc()).limit(limit)
    )
    return list(result.scalars().unique().all())


async def list_orders_for_client(session: AsyncSession, client_id: UUID) -> list[Order]:
    result = await session.execute(
        select(Order)
        .options(*order_load_options())
        .where(Order.client_id == client_id)
        .order_by(Order.created_at.desc())
    )
    return list(result.scalars().unique().all())


async def delete_order_by_id(session: AsyncSession, order_id: UUID) -> None:
    order = await session.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.current_offer_id is not None:
        order.current_offer_id = None

    if order.source_dialogue_id is not None:
        order.source_dialogue_id = None

    await session.execute(
        update(Dialogue)
        .where(Dialogue.order_id == order_id)
        .values(order_id=None)
    )
    await session.execute(delete(EventLog).where(EventLog.order_id == order_id))
    await session.execute(delete(OrderOffer).where(OrderOffer.order_id == order_id))
    await session.flush()
    await session.delete(order)
    await session.commit()


def _matching_drivers_base_query(order: Order) -> Select[tuple[Driver]]:
    requested_volume = get_order_requested_volume(order)
    return (
        select(Driver)
        .join(Driver.vehicle)
        .options(selectinload(Driver.vehicle).selectinload(Vehicle.delivery_option))
        .where(Driver.status == DriverStatus.available.value)
        .where(Driver.is_active.is_(True))
        .where(Driver.is_auto_dispatch_enabled.is_(True))
        .where(Driver.moderation_status == ModerationStatus.approved.value)
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

    await advance_dispatch_for_order(
        session,
        order.id,
        allow_attempted_fallback=True,
        excluded_driver_ids={driver_id},
    )
    await session.commit()
    return await get_order_by_id(session, order.id)


async def restart_dispatch_for_order(session: AsyncSession, order_id: UUID) -> Order:
    order = await get_order_by_id(session, order_id)
    if order.status in {
        OrderStatus.driver_assigned.value,
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

    await advance_dispatch_for_order(session, order.id, exclude_attempted_drivers=False)
    await session.commit()
    return await get_order_by_id(session, order.id)


async def assign_order_to_driver(session: AsyncSession, *, order_id: UUID, driver_id: UUID) -> Order:
    order = await get_order_by_id(session, order_id)
    driver = await session.get(Driver, driver_id, options=(selectinload(Driver.vehicle),))
    requested_volume = get_order_requested_volume(order)

    if driver is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Driver not found")
    if not driver.is_active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Driver is inactive",
        )
    if driver.moderation_status != ModerationStatus.approved.value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=MANUAL_ASSIGN_APPROVAL_ERROR)
    if driver.vehicle is None or driver.vehicle_id is None or not driver.vehicle.is_active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Driver must have an active vehicle before assignment",
        )
    if driver.vehicle.moderation_status != ModerationStatus.approved.value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=MANUAL_ASSIGN_APPROVAL_ERROR)
    if driver.status != DriverStatus.available.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Driver is not available for assignment",
        )
    if order.status not in {
        OrderStatus.created.value,
            OrderStatus.searching_driver.value,
            OrderStatus.offered_to_driver.value,
            OrderStatus.no_driver_found.value,
        }:
        if order.status == OrderStatus.driver_assigned.value and order.driver_id == driver_id:
            return order
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Order cannot be assigned manually in the current status",
        )
    if not vehicle_matches_requested_volume(driver.vehicle, requested_volume):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Driver vehicle does not match order volume",
        )

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

    await add_event(
        session,
        order.id,
        "driver_assigned_manual",
        f"Driver {driver.id} assigned manually by logist",
    )
    await session.commit()
    return await get_order_by_id(session, order.id)


async def get_current_incoming_offer_for_driver(session: AsyncSession, driver_id: UUID) -> OrderOffer | None:
    now = utcnow()
    result = await session.execute(
        select(OrderOffer)
        .options(
            selectinload(OrderOffer.order).selectinload(Order.items).selectinload(OrderItem.material),
            selectinload(OrderOffer.order).selectinload(Order.client),
            selectinload(OrderOffer.order).selectinload(Order.delivery_option),
        )
        .where(OrderOffer.driver_id == driver_id)
        .where(OrderOffer.status == OrderOfferStatus.pending.value)
        .where(or_(OrderOffer.expires_at.is_(None), OrderOffer.expires_at > now))
        .order_by(OrderOffer.offered_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_current_assigned_order_for_driver(session: AsyncSession, driver_id: UUID) -> Order | None:
    # Manual logist assignments must remain visible even when there is no live
    # offer record tied to the order. Resolve the active driver order strictly
    # from order ownership and status.
    result = await session.execute(
        select(Order)
        .options(*order_load_options())
        .where(Order.driver_id == driver_id)
        .where(Order.status.in_([OrderStatus.driver_assigned.value, OrderStatus.in_progress.value]))
        .order_by(Order.assigned_at.desc().nullslast(), Order.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def list_orders_for_driver(session: AsyncSession, driver_id: UUID, limit: int = 50) -> list[Order]:
    result = await session.execute(
        select(Order)
        .options(*order_load_options())
        .where(Order.driver_id == driver_id)
        .order_by(Order.assigned_at.desc().nullslast(), Order.created_at.desc())
        .limit(limit)
    )
    return list(result.scalars().unique().all())


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
            await expire_offer(session, current_offer)
            await session.commit()
        return

    await advance_dispatch_for_order(session, order_id)
    await session.commit()
