"""Explicit cleanup for administrator-only permanent order deletion.

Soft archive uses dispatch_service.delete_order_by_id and retains history.
All SQL here belongs to one transaction; no payment-provider calls are made.
"""
import logging
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.commerce import Payment, PaymentEvent, PaymentQuote, Refund, SettlementReceipt
from app.models.models import (
    Dialogue, Driver, DriverStatus, EventLog, Order, OrderDistributionHistory,
    OrderEvent, OrderItem, OrderOffer, PushDelivery, UserNotification,
)
from app.services.dispatch_service import ACTIVE_ASSIGNED_ORDER_STATUSES

logger = logging.getLogger(__name__)


async def hard_delete_order_by_id(
    db: AsyncSession, order_id: UUID, *, actor_id: UUID,
) -> None:
    try:
        order = await db.scalar(select(Order).where(Order.id == order_id).with_for_update())
        if order is None:
            raise HTTPException(status_code=404, detail="Order not found")
        driver_id = order.driver_id

        # Break both cycles before removing children. Conversations remain intact.
        await db.execute(update(Order).where(Order.id == order_id).values(
            current_offer_id=None, source_dialogue_id=None,
        ))
        await db.execute(update(Dialogue).where(Dialogue.order_id == order_id).values(order_id=None))

        payment_ids = select(Payment.id).where(Payment.order_id == order_id)
        for model in (PaymentEvent, Refund, SettlementReceipt):
            await db.execute(delete(model).where(model.payment_id.in_(payment_ids)))
        await db.execute(delete(Payment).where(Payment.order_id == order_id))
        await db.execute(delete(PaymentQuote).where(PaymentQuote.order_id == order_id))

        # Inbox/outbox order links are JSON, not foreign keys. Remove stale deliveries too.
        for model in (PushDelivery, UserNotification):
            await db.execute(delete(model).where(model.payload["order_id"].astext == str(order_id)))
        for model in (OrderDistributionHistory, OrderEvent, EventLog, OrderOffer, OrderItem):
            await db.execute(delete(model).where(model.order_id == order_id))
        await db.execute(delete(Order).where(Order.id == order_id))

        # Do not leave the last assigned driver permanently busy after removing a job.
        if driver_id is not None:
            driver = await db.scalar(select(Driver).where(Driver.id == driver_id).with_for_update())
            if driver is not None and driver.status == DriverStatus.busy.value:
                remaining = await db.scalar(select(Order.id).where(
                    Order.driver_id == driver_id,
                    Order.is_deleted.is_(False),
                    Order.status.in_(ACTIVE_ASSIGNED_ORDER_STATUSES),
                ).limit(1))
                if remaining is None:
                    driver.status = DriverStatus.available.value if driver.is_on_shift else DriverStatus.offline.value
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        cause = getattr(exc.orig, "__cause__", None)
        logger.exception("order_hard_delete_conflict", extra={
            "order_id": str(order_id), "actor_id": str(actor_id),
            "constraint_name": getattr(cause, "constraint_name", None),
        })
        raise HTTPException(status_code=409, detail=(
            "Не удалось полностью удалить заказ из-за связанной записи. "
            "Изменения отменены. Обратитесь в поддержку."
        )) from exc
    except Exception:
        await db.rollback()
        raise

    logger.info("order_hard_deleted", extra={"order_id": str(order_id), "actor_id": str(actor_id)})
