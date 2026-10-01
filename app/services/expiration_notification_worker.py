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


def expiration_stage(ends_at, now):
    remaining = ends_at - now
    if remaining.total_seconds() <= 0: return 'expired'
    if remaining <= timedelta(days=1): return '1day'
    if remaining <= timedelta(days=3): return '3days'
    return None


async def run_expiration_notification_tick(session_factory=AsyncSessionLocal, *, now=None) -> int:
    from app.models.models import Quarry, User
    from app.services.notification_outbox import enqueue
    current_time = now or utcnow()
    notified_count = 0
    emails = []
    async with session_factory() as session:
        for model, kind in ((Quarry, 'pickup_point'), (SpecialEquipmentListing, 'equipment')):
            filters = [model.placement_ends_at.is_not(None), model.placement_ends_at <= current_time + timedelta(days=3),
                model.placement_status.not_in(('archived', 'pending_moderation')),
                model.moderation_status.in_(('approved', 'has_pending_changes'))]
            if model is SpecialEquipmentListing: filters.append(model.is_deleted.is_(False))
            entities = list((await session.scalars(select(model).where(*filters).order_by(model.placement_ends_at).with_for_update(skip_locked=True))).all())
            for entity in entities:
                owner_id = entity.owner_user_id or getattr(entity, 'created_by_user_id', None)
                if owner_id is None: continue
                stage = expiration_stage(entity.placement_ends_at, current_time)
                title = 'Продлите размещение' if stage == 'expired' else EXPIRATION_NOTICE_TITLE
                body = 'Срок размещения истёк. Откройте профиль и продлите размещение.' if stage == 'expired' else ('Размещение закончится в течение суток. Продлите его в профиле.' if stage == '1day' else ('Размещение закончится в течение трёх дней. Продлите его в профиле.' if kind == 'pickup_point' else EXPIRATION_NOTICE_BODY))
                end = entity.placement_ends_at.isoformat()
                event_type = f'{kind}_placement_expired' if stage == 'expired' else f'{kind}_placement_expiring'
                created = await enqueue(session, key=f'placement:{kind}:{entity.id}:{end}:{stage}', recipient_type='user', recipient_id=owner_id,
                    event_type=event_type, title=title, body=body, inbox=True,
                    payload={'entity_type': kind, 'entity_id': str(entity.id), 'placement_end': end, 'stage': stage,
                        'city_id': str(entity.city_id or ''), 'listing_id' if kind == 'equipment' else 'pickup_point_id': str(entity.id)})
                if created:
                    notified_count += 1
                    if kind == 'equipment':
                        entity.expiration_notice_sent = True
                        if stage == '3days':
                            owner = await session.get(User, owner_id)
                            if owner and owner.email: emails.append(owner.email)
        await session.commit()
    for email in emails:
        try:
            await asyncio.to_thread(send_email, to_email=email, subject="Дармавоз: срок размещения скоро истечёт", body=EXPIRATION_NOTICE_BODY)
        except Exception:
            logger.exception("equipment_expiration_email_failed")
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
