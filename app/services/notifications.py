from __future__ import annotations

import asyncio
import logging
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.database import AsyncSessionLocal
from app.models.models import (
    Order,
    Quarry,
    SpecialEquipmentApplication,
    SpecialEquipmentListing,
    Role,
    User,
    UserNotification,
)
from app.services.push_service import (
    schedule_push_to_client,
    schedule_push_to_driver,
    schedule_push_to_logists,
    schedule_push_to_user,
)

logger = logging.getLogger(__name__)


async def create_operator_notifications(session, *, event_type: str, title: str, body: str, payload: dict[str, str]) -> None:
    """Persist operator inbox records in the same transaction as the business event."""
    result = await session.execute(
        select(User.id).join(Role, User.role_id == Role.id).where(
            Role.name.in_(("admin", "logist")), User.is_active.is_(True), User.is_deleted.is_(False)
        )
    )
    for user_id in result.scalars():
        session.add(UserNotification(user_id=user_id, event_type=event_type, title=title, body=body, payload=payload))


def _safe_schedule(schedule_func, *args, **kwargs) -> None:
    try:
        schedule_func(*args, **kwargs)
    except Exception:
        logger.exception("push_schedule_failed")


def _order_push_data(order: Order) -> dict[str, str]:
    return {
        "order_id": str(order.id),
        "status": str(order.status),
    }


def _format_order_label(order: Order) -> str:
    return f"#{order.id}"


def _format_driver_label(driver_name: str | None, driver_id: UUID) -> str:
    if driver_name and driver_name.strip():
        return driver_name.strip()
    return str(driver_id)


def schedule_client_order_created_notification(order: Order) -> None:
    logger.info(
        "client_push_scheduled",
        extra={
            "event": "order_created",
            "order_id": str(order.id),
            "client_id": str(order.client_id),
            "order_status": str(order.status),
        },
    )
    _safe_schedule(
        schedule_push_to_client,
        order.client_id,
        "Заказ создан",
        "Ваш заказ создан. Мы уже ищем исполнителя.",
        _order_push_data(order),
    )


def schedule_client_driver_assigned_notification(order: Order) -> None:
    logger.info(
        "client_push_scheduled",
        extra={
            "event": "driver_assigned",
            "order_id": str(order.id),
            "client_id": str(order.client_id),
            "order_status": str(order.status),
        },
    )
    _safe_schedule(
        schedule_push_to_client,
        order.client_id,
        "Водитель назначен",
        "Для вашего заказа назначен водитель. Статус обновлен в приложении.",
        _order_push_data(order),
    )


def schedule_client_heading_to_client_notification(order: Order) -> None:
    logger.info(
        "client_push_scheduled",
        extra={
            "event": "heading_to_client",
            "order_id": str(order.id),
            "client_id": str(order.client_id),
            "order_status": str(order.status),
        },
    )
    _safe_schedule(
        schedule_push_to_client,
        order.client_id,
        "Водитель выехал",
        "Водитель загрузился и выехал к вам.",
        _order_push_data(order),
    )


def schedule_client_order_completed_notification(order: Order) -> None:
    logger.info(
        "client_push_scheduled",
        extra={
            "event": "completed",
            "order_id": str(order.id),
            "client_id": str(order.client_id),
            "order_status": str(order.status),
        },
    )
    _safe_schedule(
        schedule_push_to_client,
        order.client_id,
        "Заказ завершен",
        "Ваш заказ завершен. Спасибо, что выбрали Дармавоз.",
        _order_push_data(order),
    )


def schedule_client_searching_driver_status_notification(order: Order) -> None:
    _safe_schedule(
        schedule_push_to_client,
        order.client_id,
        "Поиск машины",
        "Ищем водителя для вашего заказа.",
        _order_push_data(order),
    )


def schedule_client_requires_clarification_notification(order: Order, comment: str) -> None:
    _safe_schedule(
        schedule_push_to_client,
        order.client_id,
        "Требуется уточнение по заказу",
        f"Пожалуйста, уточните детали заказа. Причина: {comment}",
        {**_order_push_data(order), "event": "requires_clarification"},
    )


def schedule_client_driver_assigned_status_notification(order: Order) -> None:
    _safe_schedule(
        schedule_push_to_client,
        order.client_id,
        "Водитель найден",
        "Машина назначена на ваш заказ.",
        _order_push_data(order),
    )


def schedule_client_heading_to_pickup_status_notification(order: Order) -> None:
    _safe_schedule(
        schedule_push_to_client,
        order.client_id,
        "В пути на погрузку",
        "Машина едет на карьер.",
        _order_push_data(order),
    )


def schedule_client_heading_to_client_status_notification(order: Order) -> None:
    _safe_schedule(
        schedule_push_to_client,
        order.client_id,
        "В пути к вам",
        "Машина загружена и едет к вам!",
        _order_push_data(order),
    )


def schedule_client_completed_status_notification(order: Order) -> None:
    _safe_schedule(
        schedule_push_to_client,
        order.client_id,
        "Заказ завершен",
        "Спасибо, что выбрали Дармавоз!",
        _order_push_data(order),
    )


def schedule_driver_new_order_notification(order: Order, driver_id: UUID) -> None:
    _safe_schedule(
        schedule_push_to_driver,
        driver_id,
        "Новый заказ!",
        "Поступило новое предложение. Успейте принять заказ.",
        _order_push_data(order),
    )


def schedule_driver_manual_assignment_notification(order: Order, driver_id: UUID) -> None:
    _safe_schedule(
        schedule_push_to_driver,
        driver_id,
        "Вам назначен рейс",
        "Логист добавил новый заказ в ваш профиль. Можно выезжать на карьер.",
        _order_push_data(order),
    )


def schedule_driver_order_changed_notification(order: Order, driver_id: UUID) -> None:
    _safe_schedule(
        schedule_push_to_driver,
        driver_id,
        "Детали заказа изменены",
        "Логист обновил информацию по текущему рейсу.",
        _order_push_data(order),
    )


def schedule_driver_order_cancelled_notification(order: Order, driver_id: UUID) -> None:
    _safe_schedule(
        schedule_push_to_driver,
        driver_id,
        "Заказ отменен",
        "К сожалению, текущий рейс был отменен. Вы снова свободны.",
        _order_push_data(order),
    )


def schedule_driver_order_reminder_notification(order: Order, driver_id: UUID) -> None:
    _safe_schedule(
        schedule_push_to_driver,
        driver_id,
        "Напоминание по заказу",
        "У вас есть активный заказ. Проверьте текущий этап выполнения.",
        _order_push_data(order),
    )


def schedule_logist_driver_rejected_notification(
    order: Order,
    driver_id: UUID,
    driver_name: str | None = None,
) -> None:
    driver_label = _format_driver_label(driver_name, driver_id)
    _safe_schedule(
        schedule_push_to_logists,
        "Отказ водителя!",
        f"Водитель {driver_label} отказался от заказа {_format_order_label(order)}. Ищем следующего.",
        {
            **_order_push_data(order),
            "driver_id": str(driver_id),
            "driver_name": driver_name or "",
            "event": "driver_cancel",
        },
    )


def schedule_logist_timeout_notification(order: Order, driver_id: UUID) -> None:
    _safe_schedule(
        schedule_push_to_logists,
        "Таймаут!",
        f"Водитель не ответил на заказ {_format_order_label(order)}. Ищем дальше.",
        {
            **_order_push_data(order),
            "driver_id": str(driver_id),
            "event": "timeout",
        },
    )


def schedule_logist_no_driver_found_notification(order: Order) -> None:
    _safe_schedule(
        schedule_push_to_logists,
        "Внимание!",
        f"Заказ {_format_order_label(order)} остался без исполнителя. Требуется ручное назначение.",
        {
            **_order_push_data(order),
            "event": "no_driver_found",
        },
    )


def schedule_logist_order_created_notification(order: Order) -> None:
    _safe_schedule(
        schedule_push_to_logists,
        "Новый заказ",
        f"Поступил новый заказ #{order.id}.",
        {**_order_push_data(order), "event": "order_created"},
    )


def schedule_logist_requires_clarification_notification(order: Order) -> None:
    _safe_schedule(
        schedule_push_to_logists,
        "Заказ требует уточнения",
        f"Заказ #{order.id} ожидает ручной проверки оператором.",
        {**_order_push_data(order), "event": "requires_clarification"},
    )


def schedule_pickup_point_moderation_notification(
    point: Quarry,
    *,
    is_resubmission: bool = False,
) -> None:
    point_type_ru = "Точка забора"
    if point.point_type == "quarry":
        point_type_ru = "Карьер"
    elif point.point_type in {"accumulator", "warehouse", "supplier"}:
        point_type_ru = "Накопитель"

    title = "Новая заявка на модерацию"
    body = (
        f'Поставщик добавил новый {point_type_ru} "{point.name}" и ожидает проверки.'
    )
    if is_resubmission:
        title = "Изменения точки ожидают модерации"
        body = (
            f'Поставщик отправил изменения по точке "{point.name}" на повторную '
            "модерацию."
        )

    logger.info(
        "pickup_point_moderation_push_scheduled",
        extra={
            "event": "pickup_point_pending_moderation",
            "pickup_point_id": str(point.id),
            "owner_user_id": str(point.owner_user_id) if point.owner_user_id else None,
        },
    )
    _safe_schedule(
        schedule_push_to_logists,
        title,
        body,
        {
            "event": "pickup_point_pending_moderation",
            "pickup_point_id": str(point.id),
            "is_resubmission": "true" if is_resubmission else "false",
            "moderation_scope": "pickup_point",
        },
    )


def schedule_equipment_listing_moderation_notification(
    listing: SpecialEquipmentListing,
    *,
    is_resubmission: bool = False,
) -> None:
    equipment_type = (listing.equipment_type or "спецтехника").strip() or "спецтехника"
    listing_title = (listing.title or "Без названия").strip() or "Без названия"
    title = "Новое объявление ожидает модерации"
    body = (
        f'Поставщик добавил объявление "{listing_title}" '
        f"({equipment_type}) и ожидает проверки."
    )
    if is_resubmission:
        title = "Изменения объявления ожидают модерации"
        body = (
            f'Поставщик отправил изменения объявления "{listing_title}" '
            "на повторную модерацию."
        )

    logger.info(
        "equipment_listing_moderation_push_scheduled",
        extra={
            "event": "equipment_listing_pending_moderation",
            "listing_id": str(listing.id),
            "owner_user_id": str(listing.owner_user_id) if listing.owner_user_id else None,
        },
    )
    _safe_schedule(
        schedule_push_to_logists,
        title,
        body,
        {
            "event": "equipment_listing_pending_moderation",
            "listing_id": str(listing.id),
            "is_resubmission": "true" if is_resubmission else "false",
            "moderation_scope": "equipment_listing",
        },
    )


def schedule_equipment_application_notification(
    application: SpecialEquipmentApplication,
) -> None:
    _safe_schedule(
        schedule_push_to_logists,
        "Новая заявка на спецтехнику",
        f"Клиент оставил заявку на {application.listing_title_snapshot}",
        {
            "event": "equipment_application_created",
            "application_id": str(application.id),
            "listing_id": str(application.listing_id),
        },
    )


def schedule_equipment_application_rejected_notification(
    application: SpecialEquipmentApplication,
) -> None:
    reason = (application.reject_reason or "").strip()
    _safe_schedule(
        schedule_push_to_client,
        application.client_id,
        "Заявка на технику отклонена",
        f"Ваша заявка на технику отклонена. Причина: {reason}",
        {
            "event": "equipment_application_rejected",
            "application_id": str(application.id),
            "listing_id": str(application.listing_id),
        },
    )


def schedule_equipment_application_cancelled_notification(
    application: SpecialEquipmentApplication,
) -> None:
    reason = (application.cancel_reason or "").strip()
    _safe_schedule(
        schedule_push_to_logists,
        "Заявка на спецтехнику отменена",
        f"Клиент отменил заявку на {application.listing_title_snapshot}. Причина: {reason}",
        {
            "event": "equipment_application_cancelled",
            "application_id": str(application.id),
            "listing_id": str(application.listing_id),
        },
    )


def _support_role_label(role: str | None) -> str:
    mapping = {
        "client": "Клиент",
        "driver": "Водитель",
        "admin": "Администратор",
        "logist": "Логист",
        "operator": "Оператор",
    }
    return mapping.get((role or "").strip().lower(), "Пользователь")


def _support_message_preview(text: str | None, attachment_url: str | None = None) -> str:
    normalized = (text or "").strip()
    if not normalized:
        normalized = "Фото во вложении" if attachment_url else "Новое сообщение"
    if len(normalized) > 160:
        return f"{normalized[:157].rstrip()}..."
    return normalized


async def _load_support_ticket(ticket_id: UUID):
    from app.models.models import SupportMessage, SupportTicket, User

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(SupportTicket)
            .options(
                selectinload(SupportTicket.client),
                selectinload(SupportTicket.user).selectinload(User.role),
                selectinload(SupportTicket.user).selectinload(User.driver_profile),
                selectinload(SupportTicket.messages).selectinload(SupportMessage.author_client),
                selectinload(SupportTicket.messages)
                .selectinload(SupportMessage.author_user)
                .selectinload(User.role),
            )
            .where(SupportTicket.id == ticket_id)
        )
        return result.scalar_one_or_none()


async def _send_support_operator_notification(ticket_id: UUID, *, is_new: bool) -> None:
    ticket = await _load_support_ticket(ticket_id)
    if ticket is None or not ticket.messages:
        logger.warning("support_push_ticket_not_found", extra={"ticket_id": str(ticket_id)})
        return

    last_message = max(ticket.messages, key=lambda item: item.created_at)
    sender_role = "client" if last_message.author_client_id else (
        last_message.author_user.role.name
        if last_message.author_user and last_message.author_user.role
        else "driver"
    )
    role_label = _support_role_label(sender_role)
    preview = _support_message_preview(last_message.text, last_message.attachment_url)
    title = (
        f"Новое обращение: {ticket.subject}. От: {role_label}"
        if is_new
        else f"Ответ от {role_label}: {ticket.subject}"
    )
    _safe_schedule(
        schedule_push_to_logists,
        title,
        preview,
        {
            "event": "support_ticket_created" if is_new else "support_message_created",
            "ticket_id": str(ticket_id),
            "requester_role": sender_role,
        },
    )


async def _send_support_reply_notification(
    *,
    ticket_id: UUID,
    client_id: UUID | None = None,
    driver_id: UUID | None = None,
    user_id: UUID | None = None,
) -> None:
    ticket = await _load_support_ticket(ticket_id)
    if ticket is None or not ticket.messages:
        logger.warning("support_reply_push_ticket_not_found", extra={"ticket_id": str(ticket_id)})
        return

    last_message = max(ticket.messages, key=lambda item: item.created_at)
    preview = _support_message_preview(last_message.text, last_message.attachment_url)
    data = {"event": "support_operator_reply", "ticket_id": str(ticket_id)}
    title = "\u041f\u043e\u0434\u0434\u0435\u0440\u0436\u043a\u0430 \u0414\u0430\u0440\u043c\u0430\u0432\u043e\u0437\u0430"
    body = f"\u041e\u0442\u0432\u0435\u0442 \u043e\u0442 \u041f\u043e\u0434\u0434\u0435\u0440\u0436\u043a\u0438: {preview}"
    if client_id is not None:
        _safe_schedule(schedule_push_to_client, client_id, title, body, data)
    elif driver_id is not None:
        _safe_schedule(schedule_push_to_driver, driver_id, title, body, data)
    elif user_id is not None:
        _safe_schedule(schedule_push_to_user, user_id, title, body, data)


async def send_support_operator_notification(ticket_id: UUID, is_new: bool) -> None:
    try:
        await _send_support_operator_notification(ticket_id, is_new=is_new)
    except Exception:
        logger.exception(
            "support_operator_notification_failed",
            extra={"ticket_id": str(ticket_id), "is_new": is_new},
        )


async def send_support_reply_notification(
    *,
    ticket_id: UUID,
    client_id: UUID | None = None,
    driver_id: UUID | None = None,
    user_id: UUID | None = None,
) -> None:
    try:
        await _send_support_reply_notification(
            ticket_id=ticket_id,
            client_id=client_id,
            driver_id=driver_id,
            user_id=user_id,
        )
    except Exception:
        logger.exception(
            "support_reply_notification_failed",
            extra={
                "ticket_id": str(ticket_id),
                "client_id": str(client_id) if client_id is not None else None,
                "driver_id": str(driver_id) if driver_id is not None else None,
                "user_id": str(user_id) if user_id is not None else None,
            },
        )


def schedule_support_operator_notification(ticket_id: UUID, *, is_new: bool) -> None:
    _safe_schedule(
        schedule_push_to_logists,
        "Новое обращение в поддержку" if is_new else "Новое сообщение в поддержке",
        "Пользователь ожидает ответа оператора",
        {
            "event": "support_ticket_created" if is_new else "support_message_created",
            "ticket_id": str(ticket_id),
        },
    )


def schedule_support_reply_notification(
    *,
    ticket_id: UUID,
    client_id: UUID | None = None,
    driver_id: UUID | None = None,
    user_id: UUID | None = None,
) -> None:
    data = {"event": "support_operator_reply", "ticket_id": str(ticket_id)}
    if client_id is not None:
        _safe_schedule(
            schedule_push_to_client,
            client_id,
            "Ответ службы поддержки",
            "Оператор ответил на ваше обращение",
            data,
        )
    elif driver_id is not None:
        _safe_schedule(
            schedule_push_to_driver,
            driver_id,
            "Ответ службы поддержки",
            "Оператор ответил на ваше обращение",
            data,
        )
def schedule_support_operator_notification(ticket_id: UUID, *, is_new: bool) -> None:
    asyncio.create_task(
        _send_support_operator_notification(ticket_id, is_new=is_new),
        name=f"support-operator-push-{ticket_id}",
    )


def schedule_support_reply_notification(
    *,
    ticket_id: UUID,
    client_id: UUID | None = None,
    driver_id: UUID | None = None,
    user_id: UUID | None = None,
) -> None:
    asyncio.create_task(
        _send_support_reply_notification(
            ticket_id=ticket_id,
            client_id=client_id,
            driver_id=driver_id,
            user_id=user_id,
        ),
        name=f"support-reply-push-{ticket_id}",
    )
