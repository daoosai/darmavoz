from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.models import (
    Client,
    DeliveryOption,
    Driver,
    DriverStatus,
    EventLog,
    Material,
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
    address: str,
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

    material, delivery_option = await validate_material_and_delivery_option(
        session, material_id=material_id, delivery_option_id=delivery_option_id
    )
    order = await build_order(
        session,
        client=client,
        material=material,
        delivery_option=delivery_option,
        address=address,
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


async def list_recent_orders(session: AsyncSession, limit: int = 20) -> list[Order]:
    result = await session.execute(
        select(Order).options(*order_load_options()).order_by(Order.created_at.desc()).limit(limit)
    )
    return list(result.scalars().unique().all())


async def get_matching_drivers(session: AsyncSession, order: Order) -> list[Driver]:
    now = utcnow()
    attempted_driver_ids = (
        select(OrderOffer.driver_id)
        .where(OrderOffer.order_id == order.id)
        .scalar_subquery()
    )
    stmt: Select[tuple[Driver]] = (
        select(Driver)
        .join(Driver.vehicle)
        .options(selectinload(Driver.vehicle).selectinload(Vehicle.delivery_option))
        .where(Driver.status == DriverStatus.available.value)
        .where(Driver.is_auto_dispatch_enabled.is_(True))
        .where(Driver.vehicle_id.is_not(None))
        .where(Vehicle.is_active.is_(True))
        .where(Vehicle.delivery_option_id == order.delivery_option_id)
        .where(
            or_(
                Driver.temporary_penalty_until.is_(None),
                Driver.temporary_penalty_until <= now,
            )
        )
        .where(Driver.id.not_in(attempted_driver_ids))
        .order_by(Driver.dispatch_priority.desc(), Driver.last_offer_at.asc().nullsfirst(), Driver.id.asc())
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


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


async def advance_dispatch_for_order(session: AsyncSession, order_id: UUID) -> Order:
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

    candidates = await get_matching_drivers(session, order)
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
    return await advance_dispatch_for_order(session, order.id)


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

    await advance_dispatch_for_order(session, order.id)
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
    result = await session.execute(
        select(Order)
        .options(*order_load_options())
        .where(Order.driver_id == driver_id)
        .where(Order.status.in_([OrderStatus.driver_assigned.value, OrderStatus.in_progress.value]))
        .order_by(Order.assigned_at.desc().nullslast(), Order.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


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
