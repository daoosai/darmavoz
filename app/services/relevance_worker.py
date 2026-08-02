import asyncio
import contextlib
import logging

from sqlalchemy import select

from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models.models import PlacementStatus, Quarry, SpecialEquipmentListing
from app.services.relevance import recalculate_status, utcnow


logger = logging.getLogger(__name__)


async def _process_model(session, model, *, limit: int) -> int:
    now = utcnow()
    result = await session.execute(
        select(model)
        .where(model.placement_status != PlacementStatus.archived.value)
        .where(
            (model.placement_ends_at.is_not(None) & (model.placement_ends_at <= now))
            | (model.next_confirmation_at.is_not(None) & (model.next_confirmation_at <= now))
        )
        .order_by(model.next_confirmation_at.asc().nulls_last(), model.placement_ends_at.asc().nulls_last())
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    entities = list(result.scalars().all())
    processed = 0
    for entity in entities:
        try:
            async with session.begin_nested():
                await recalculate_status(session, entity, action="worker_transition", now=now)
            processed += 1
        except Exception:
            logger.exception(
                "relevance_entity_failed",
                extra={"entity_type": model.__tablename__, "entity_id": str(entity.id)},
            )
    return processed


async def run_relevance_tick(session_factory=AsyncSessionLocal) -> int:
    async with session_factory() as session:
        point_count = await _process_model(
            session, Quarry, limit=settings.PLACEMENT_WORKER_BATCH_SIZE
        )
        remaining = max(settings.PLACEMENT_WORKER_BATCH_SIZE - point_count, 0)
        equipment_count = 0
        if remaining:
            equipment_count = await _process_model(
                session, SpecialEquipmentListing, limit=remaining
            )
        await session.commit()
        return point_count + equipment_count


async def relevance_loop(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await run_relevance_tick()
        except Exception:
            logger.exception("relevance_loop_failed")
        try:
            await asyncio.wait_for(
                stop_event.wait(), timeout=settings.PLACEMENT_WORKER_INTERVAL_SECONDS
            )
        except asyncio.TimeoutError:
            continue


async def start_relevance_worker() -> tuple[asyncio.Event, asyncio.Task[None]]:
    stop_event = asyncio.Event()
    task = asyncio.create_task(relevance_loop(stop_event), name="relevance-worker")
    return stop_event, task


async def stop_relevance_worker(
    stop_event: asyncio.Event | None, task: asyncio.Task[None] | None
) -> None:
    if stop_event is None or task is None:
        return
    stop_event.set()
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
