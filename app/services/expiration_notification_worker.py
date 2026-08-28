from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models.models import SpecialEquipmentListing, UserNotification
from app.services.email_service import send_email
from app.services.relevance import public_placement_filters, utcnow


logger = logging.getLogger(__name__)

EXPIRATION_NOTICE_EVENT_TYPE = "equipment_placement_expiring"
EXPIRATION_NOTICE_TITLE = "Срок размещения скоро истечёт"
EXPIRATION_NOTICE_BODY = (
    "Ваше объявление о спецтехнике перестанет отображаться в каталоге через 3 дня. "
    "Пожалуйста, зайдите в профиль и продлите размещение, чтобы не терять заказы."
)


async def run_expiration_notification_tick(
    session_factory=AsyncSessionLocal,
    *,
    now: datetime | None = None,
) -> int:
    """Create one in-app notice per listing and send the matching email."""
    current_time = now or utcnow()
    window_start = current_time + timedelta(days=2)
    window_end = current_time + timedelta(days=3)
    emails: list[tuple[str, str]] = []
    notified_count = 0

    async with session_factory() as session:
        result = await session.execute(
            select(SpecialEquipmentListing)
            .options(
                selectinload(SpecialEquipmentListing.owner),
                selectinload(SpecialEquipmentListing.created_by),
            )
            .where(
                *public_placement_filters(SpecialEquipmentListing),
                SpecialEquipmentListing.placement_ends_at >= window_start,
                SpecialEquipmentListing.placement_ends_at < window_end,
                SpecialEquipmentListing.expiration_notice_sent.is_(False),
            )
            .order_by(SpecialEquipmentListing.placement_ends_at.asc())
            .limit(settings.EXPIRATION_NOTIFICATION_BATCH_SIZE)
            .with_for_update(skip_locked=True)
        )
        listings = list(result.scalars().unique().all())

        for listing in listings:
            recipient = listing.owner or listing.created_by
            if recipient is None:
                logger.warning(
                    "equipment_expiration_notice_recipient_missing",
                    extra={"listing_id": str(listing.id)},
                )
                continue

            session.add(
                UserNotification(
                    user_id=recipient.id,
                    event_type=EXPIRATION_NOTICE_EVENT_TYPE,
                    title=EXPIRATION_NOTICE_TITLE,
                    body=EXPIRATION_NOTICE_BODY,
                    payload={
                        "listing_id": str(listing.id),
                        "event": EXPIRATION_NOTICE_EVENT_TYPE,
                    },
                )
            )
            listing.expiration_notice_sent = True
            notified_count += 1
            if recipient.email:
                emails.append((recipient.email, listing.title))

        await session.commit()

    for email, listing_title in emails:
        try:
            await asyncio.to_thread(
                send_email,
                to_email=email,
                subject="Дармавоз: срок размещения скоро истечёт",
                body=EXPIRATION_NOTICE_BODY,
            )
        except Exception:
            logger.exception(
                "equipment_expiration_email_failed",
                extra={"email": email, "listing_title": listing_title},
            )

    return notified_count


async def expiration_notification_loop(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await run_expiration_notification_tick()
        except Exception:
            logger.exception("expiration_notification_tick_failed")

        try:
            await asyncio.wait_for(
                stop_event.wait(),
                timeout=settings.EXPIRATION_NOTIFICATION_INTERVAL_SECONDS,
            )
        except asyncio.TimeoutError:
            continue


async def start_expiration_notification_worker() -> tuple[asyncio.Event, asyncio.Task[None]]:
    stop_event = asyncio.Event()
    task = asyncio.create_task(
        expiration_notification_loop(stop_event),
        name="equipment-expiration-notification-worker",
    )
    return stop_event, task


async def stop_expiration_notification_worker(
    stop_event: asyncio.Event | None,
    task: asyncio.Task[None] | None,
) -> None:
    if stop_event is None or task is None:
        return
    stop_event.set()
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
