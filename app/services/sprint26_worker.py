"""Restart-safe background subscription processing and journey maintenance."""
import asyncio
import contextlib
import logging
from sqlalchemy import text
from app.db.database import AsyncSessionLocal
from app.services import subscriptions, subscription_billing, journey

logger = logging.getLogger(__name__)


async def tick(factory=AsyncSessionLocal):
    async with factory() as db:
        cfg = await subscriptions.config(db)
    if cfg["enabled"]:
        await subscription_billing.tick(factory)
    if cfg["journey_enabled"]:
        async with factory() as db:
            if await db.scalar(text("SELECT pg_try_advisory_xact_lock(260028)")):
                await journey.maintenance(db)
                await db.commit()


async def run(stop):
    while not stop.is_set():
        try:
            await tick()
        except Exception as exc:
            # Exception text can contain provider credentials or personal data.
            logger.error("sprint26_worker_failed type=%s", type(exc).__name__)
        try:
            await asyncio.wait_for(stop.wait(), timeout=5)
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
