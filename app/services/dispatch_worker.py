from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable
from uuid import UUID

from redis.asyncio import Redis

from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.services.dispatch_service import get_orders_needing_dispatch, process_dispatch_for_order
from app.services.redis_client import get_redis

logger = logging.getLogger(__name__)


async def acquire_dispatch_lock(redis: Redis, order_id: UUID) -> bool:
    return bool(
        await redis.set(
            f"dispatch:order:{order_id}",
            "1",
            ex=settings.DISPATCH_LOCK_TTL_SECONDS,
            nx=True,
        )
    )


async def release_dispatch_lock(redis: Redis, order_id: UUID) -> None:
    await redis.delete(f"dispatch:order:{order_id}")


async def run_dispatch_tick(
    redis: Redis | None = None,
    session_factory=AsyncSessionLocal,
) -> int:
    redis_client = redis or get_redis()
    processed = 0
    async with session_factory() as session:
        order_ids = await get_orders_needing_dispatch(session)

    for order_id in order_ids:
        if not await acquire_dispatch_lock(redis_client, order_id):
            continue
        try:
            async with session_factory() as session:
                await process_dispatch_for_order(session, order_id)
            processed += 1
        except Exception:
            logger.exception("dispatch_tick_failed", extra={"order_id": str(order_id)})
        finally:
            await release_dispatch_lock(redis_client, order_id)
    return processed


async def dispatch_loop(stop_event: asyncio.Event) -> None:
    redis = get_redis()
    while not stop_event.is_set():
        try:
            await run_dispatch_tick(redis)
        except Exception:
            logger.exception("dispatch_loop_failed")

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=settings.DISPATCH_POLL_INTERVAL_SECONDS)
        except asyncio.TimeoutError:
            continue


async def start_dispatch_worker() -> tuple[asyncio.Event, asyncio.Task[None]]:
    stop_event = asyncio.Event()
    task = asyncio.create_task(dispatch_loop(stop_event), name="dispatch-worker")
    return stop_event, task


async def stop_dispatch_worker(stop_event: asyncio.Event | None, task: asyncio.Task[None] | None) -> None:
    if stop_event is None or task is None:
        return
    stop_event.set()
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
