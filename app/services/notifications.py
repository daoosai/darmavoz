from __future__ import annotations

import logging
from uuid import UUID

from app.models.models import Order
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
    _safe_schedule(
        schedule_push_to_client,
        order.client_id,
        "Заказ создан",
        "Ваш заказ создан. Мы уже ищем исполнителя.",
        _order_push_data(order),
    )


def schedule_client_driver_assigned_notification(order: Order) -> None:
    _safe_schedule(
        schedule_push_to_client,
        order.client_id,
        "Водитель назначен",
        "Для вашего заказа назначен водитель. Статус обновлен в приложении.",
        _order_push_data(order),
    )


def schedule_client_heading_to_client_notification(order: Order) -> None:
    _safe_schedule(
        schedule_push_to_client,
        order.client_id,
        "Водитель выехал",
        "Водитель загрузился и выехал к вам.",
        _order_push_data(order),
    )


def schedule_client_order_completed_notification(order: Order) -> None:
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
        "Новый заказ",
        "Поступил новый заказ. Откройте приложение и подтвердите решение.",
        _order_push_data(order),
    )


def schedule_driver_order_changed_notification(order: Order, driver_id: UUID) -> None:
    _safe_schedule(
        schedule_push_to_driver,
        driver_id,
        "Внимание: Заказ изменен",
        "Логист обновил детали вашего текущего заказа (сумма/адрес). Проверьте приложение.",
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
