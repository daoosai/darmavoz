from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import Driver, Order
from app.schemas.driver import (
    DriverAssignedOrderOut,
    DriverIncomingOfferOut,
    DriverOfferDecisionIn,
    DriverOfferDecisionOut,
    DriverOfferOrderOut,
    DriverStatusUpdate,
)
from app.security.auth import get_current_driver
from app.services.dispatch_service import (
    accept_offer,
    decline_offer,
    get_current_assigned_order_for_driver,
    get_current_incoming_offer_for_driver,
    mask_phone,
)

router = APIRouter()


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
    current_driver: Driver = Depends(get_current_driver),
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
    current_driver: Driver = Depends(get_current_driver),
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
    current_driver: Driver = Depends(get_current_driver),
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
    return DriverAssignedOrderOut(
        order_id=order.id,
        status=order.status,
        assigned_at=order.assigned_at,
        order=_build_driver_order_payload(order),
    )


@router.patch("/profile/status", response_model=dict[str, str | bool])
async def update_driver_status(
    payload: DriverStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_driver: Driver = Depends(get_current_driver),
) -> dict[str, str | bool]:
    current_driver.status = payload.status
    await db.commit()
    return {"ok": True, "status": current_driver.status}
