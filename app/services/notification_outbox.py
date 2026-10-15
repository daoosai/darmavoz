"""Transactional events and retryable FCM delivery (at least once)."""
import asyncio
import contextlib
import logging
from datetime import datetime, UTC, timedelta
from uuid import UUID, uuid4
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from app.db.database import AsyncSessionLocal
from app.models.models import Client, Driver, Order, OrderOffer, PushDelivery, Quarry, Role, SpecialEquipmentListing, User, UserNotification

logger = logging.getLogger(__name__)
TITLES = {
    'order_created': 'Новый заказ', 'driver_offer_created': 'Новое предложение заказа',
    'driver_assigned': 'Водитель назначен', 'driver_assigned_manual': 'Вам назначен рейс',
    'no_driver_found': 'Не найден водитель', 'driver_declined': 'Водитель отказался',
    'driver_offer_expired': 'Время ответа истекло', 'order_updated_by_logist': 'Детали заказа изменены',
    'driver_order_reminder_sent': 'Требуется действие по заказу', 'requires_clarification': 'Требуется уточнение',
    'clarification_resolved': 'Уточнение принято', 'order_cancelled': 'Заказ отменён',
    'driver_cancelled_assigned_order': 'Водитель отменил рейс', 'dispatch_started': 'Поиск водителя',
    'driver_accepted_order': 'Водитель принял рейс', 'driver_heading_to_pickup': 'В пути на погрузку',
    'driver_arrived_at_pickup': 'Машина прибыла на погрузку', 'driver_loading': 'Началась погрузка',
    'driver_heading_to_client': 'Машина едет к получателю', 'driver_delivered_order': 'Груз доставлен',
    'driver_completed_order': 'Заказ завершён',
}

async def enqueue(session, *, key, recipient_type, recipient_id, event_type, title, body, payload, inbox=False):
    event_id = str(uuid4())
    data = {**payload, 'event_id': event_id, 'event_type': event_type, 'event': event_type}
    delivery_id = await session.scalar(insert(PushDelivery).values(id=UUID(event_id), dedupe_key=key,
        recipient_type=recipient_type, recipient_id=recipient_id, event_type=event_type,
        title=title, body=body, payload=data).on_conflict_do_nothing(index_elements=['dedupe_key']).returning(PushDelivery.id))
    if delivery_id and inbox:
        session.add(UserNotification(user_id=recipient_id, event_type=event_type, title=title, body=body, payload=data))
    if delivery_id and recipient_type == 'driver':
        driver = await session.get(Driver, recipient_id)
        if driver and driver.user_id:
            session.add(UserNotification(user_id=driver.user_id, event_type=event_type, title=title, body=body, payload=data))
    return delivery_id is not None

async def enqueue_order_event(session, order, event_id, event_type):
    if event_type not in TITLES:
        return
    title = TITLES[event_type]
    payload = {'order_id': str(order.id), 'city_id': str(order.city_id or ''), 'status': order.status}
    recipients = []
    if event_type == 'driver_offer_created':
        offer = await session.get(OrderOffer, order.current_offer_id)
        if offer:
            payload['offer_id'] = str(offer.id)
            recipients.append(('driver', offer.driver_id))
    elif event_type == 'driver_order_reminder_sent':
        if order.driver_id: recipients.append(('driver', order.driver_id))
    else:
        if order.client_id and event_type not in ('driver_declined', 'driver_offer_expired'):
            recipients.append(('client', order.client_id))
        if order.driver_id and event_type not in ('dispatch_started', 'no_driver_found'):
            recipients.append(('driver', order.driver_id))
        operators = await session.scalars(select(User.id).join(Role).where(Role.name.in_(('admin', 'logist')), User.is_active.is_(True), User.is_deleted.is_(False)))
        recipients.extend(('user', user_id) for user_id in operators)
    for kind, recipient in set(recipients):
        await enqueue(session, key=f'order:{event_id}:{kind}:{recipient}', recipient_type=kind,
            recipient_id=recipient, event_type=event_type, title=title,
            body=f'Заказ №{str(order.id)[:8]}. Откройте карточку для актуальных деталей.', payload=payload, inbox=kind == 'user')

async def delivery_is_current(session, item):
    payload = item.payload
    if payload.get('wholesale_request_id'):
        from app.models.commerce import WholesaleEvent, WholesaleRequest
        request_id = UUID(payload['wholesale_request_id'])
        request = await session.get(WholesaleRequest, request_id)
        latest = await session.scalar(select(WholesaleEvent.id).where(WholesaleEvent.request_id == request_id)
                                      .order_by(WholesaleEvent.created_at.desc(), WholesaleEvent.id.desc()).limit(1))
        if request is None or request.status != payload.get('status') or str(latest) != payload.get('wholesale_event_id'):
            return False
    if payload.get('offer_id'):
        offer = await session.get(OrderOffer, UUID(payload['offer_id']))
        if offer is None or offer.status != 'pending' or offer.expires_at <= datetime.now(UTC): return False
    if payload.get('placement_end'):
        model = Quarry if payload['entity_type'] == 'pickup_point' else SpecialEquipmentListing
        entity = await session.get(model, UUID(payload['entity_id']))
        if entity is None or entity.placement_ends_at is None or entity.placement_ends_at.isoformat() != payload['placement_end']: return False
    return True

async def run_delivery_tick(session_factory=AsyncSessionLocal):
    from app.services.push_service import _send_push, _looks_like_invalid_token_error
    count = 0
    async with session_factory() as session:
        items = list((await session.scalars(select(PushDelivery).where(PushDelivery.status == 'pending',
            PushDelivery.next_attempt_at <= datetime.now(UTC)).order_by(PushDelivery.created_at).limit(30).with_for_update(skip_locked=True))).all())
        for item in items:
            item.attempts += 1
            if not await delivery_is_current(session, item):
                item.status = 'cancelled'
                continue
            model = {'driver': Driver, 'client': Client, 'user': User}[item.recipient_type]
            recipient = await session.get(model, item.recipient_id)
            token = getattr(recipient, 'fcm_token', None)
            if not token:
                item.status = 'no_device'
                continue
            try:
                result = await asyncio.wait_for(asyncio.to_thread(_send_push, token, item.title, item.body, item.payload), timeout=20)
                if result is None: raise RuntimeError('FCM unavailable')
                item.status = 'sent'
                count += 1
            except Exception as exc:
                if _looks_like_invalid_token_error(exc):
                    recipient.fcm_token = None
                    item.status = 'invalid_token'
                else:
                    item.status = 'failed' if item.attempts >= 8 else 'pending'
                    item.next_attempt_at = datetime.now(UTC) + timedelta(seconds=min(3600, 15 * 2 ** item.attempts))
                    logger.warning('push_delivery_retry', extra={'delivery_id': str(item.id), 'attempt': item.attempts})
        await session.commit()
    return count

async def loop(stop):
    while not stop.is_set():
        try: await run_delivery_tick()
        except Exception: logger.exception('push_delivery_tick_failed')
        try: await asyncio.wait_for(stop.wait(), timeout=5)
        except asyncio.TimeoutError: pass

async def start():
    stop = asyncio.Event()
    return stop, asyncio.create_task(loop(stop), name='push-delivery-worker')

async def shutdown(stop, task):
    stop.set()
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError): await task
