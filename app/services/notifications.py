from __future__ import annotations

import logging
from uuid import UUID

from app.models.models import Order, Quarry, SpecialEquipmentApplication
from app.services.push_service import (
    schedule_push_to_client,
    schedule_push_to_driver,
    schedule_push_to_logists,
)

logger = logging.getLogger(__name__)


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


def schedule_pickup_point_moderation_notification(point: Quarry) -> None:
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
        "Новая заявка на модерацию",
        "Поставщик добавил новую точку забора и ожидает проверки",
        {
            "event": "pickup_point_pending_moderation",
            "pickup_point_id": str(point.id),
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
