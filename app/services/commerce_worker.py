import asyncio
import contextlib
import logging
from datetime import timedelta

from sqlalchemy import select, text

from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models.commerce import Payment, WholesaleEvent, WholesaleRequest
from app.services import payments

logger = logging.getLogger(__name__)


async def tick():
    from app.api.wholesale import today
    async with AsyncSessionLocal() as db:
        if not await db.scalar(text("SELECT pg_try_advisory_xact_lock(240024)")):
            return
        rows = (await db.scalars(select(WholesaleRequest).where(WholesaleRequest.status.in_(["published", "pending_moderation"]), WholesaleRequest.ends_on < today()).limit(200).with_for_update(skip_locked=True))).all()
        for row in rows:
            row.status = "closed"
            db.add(WholesaleEvent(request_id=row.id, status="closed", reason="Истёк желаемый срок"))
        await db.commit()
    if not payments.configured():
        return
    async with AsyncSessionLocal() as db:
        ids = (await db.scalars(select(Payment.id).where(Payment.status.in_(payments.ACTIVE)).where(
            (Payment.checked_at.is_(None)) | (Payment.checked_at < payments.now() - timedelta(seconds=settings.PAYMENT_POLL_INTERVAL_SECONDS))
        ).order_by(Payment.checked_at.asc().nulls_first()).limit(20))).all()
    for payment_id in ids:
        try:
            async with AsyncSessionLocal() as db:
                if await db.scalar(text("SELECT pg_try_advisory_xact_lock(hashtext(:key))"), {"key": str(payment_id)}):
                    await payments.sync_payment(db, payment_id)
        except Exception:
            # Avoid logging exceptions that may include response bodies/credentials.
            logger.error("commerce_sync_failed payment_id=%s", payment_id)


async def run(stop):
    while not stop.is_set():
        try:
            await tick()
        except Exception:
            logger.error("commerce_worker_tick_failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=settings.PAYMENT_POLL_INTERVAL_SECONDS)
        except asyncio.TimeoutError:
            pass


async def start():
    stop = asyncio.Event()
    return stop, asyncio.create_task(run(stop))


async def shutdown(stop, task):
    stop.set()
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
