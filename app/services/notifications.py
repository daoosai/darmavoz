from __future__ import annotations

from uuid import UUID

from app.models.models import Order
from app.services.push_service import (
    schedule_push_to_client,
    schedule_push_to_driver,
    schedule_push_to_logists,
)


def _order_push_data(order: Order) -> dict[str, str]:
    return {
        "order_id": str(order.id),
        "status": str(order.status),
    }


def _format_order_label(order: Order) -> str:
    return f"\u0417\u0430\u043a\u0430\u0437 {order.id}"


def schedule_client_order_created_notification(order: Order) -> None:
    schedule_push_to_client(
        order.client_id,
        "\u0417\u0430\u043a\u0430\u0437 \u0441\u043e\u0437\u0434\u0430\u043d",
        "\u0412\u0430\u0448 \u0437\u0430\u043a\u0430\u0437 \u0441\u043e\u0437\u0434\u0430\u043d. \u041c\u044b \u0443\u0436\u0435 \u0438\u0449\u0435\u043c \u0438\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044f.",
        _order_push_data(order),
    )


def schedule_client_driver_assigned_notification(order: Order) -> None:
    schedule_push_to_client(
        order.client_id,
        "\u0412\u043e\u0434\u0438\u0442\u0435\u043b\u044c \u043d\u0430\u0437\u043d\u0430\u0447\u0435\u043d",
        "\u0414\u043b\u044f \u0432\u0430\u0448\u0435\u0433\u043e \u0437\u0430\u043a\u0430\u0437\u0430 \u043d\u0430\u0437\u043d\u0430\u0447\u0435\u043d \u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044c. \u0421\u0442\u0430\u0442\u0443\u0441 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d \u0432 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0438.",
        _order_push_data(order),
    )


def schedule_client_heading_to_client_notification(order: Order) -> None:
    schedule_push_to_client(
        order.client_id,
        "\u0412\u043e\u0434\u0438\u0442\u0435\u043b\u044c \u0432\u044b\u0435\u0445\u0430\u043b",
        "\u0412\u043e\u0434\u0438\u0442\u0435\u043b\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u043b\u0441\u044f \u0438 \u0432\u044b\u0435\u0445\u0430\u043b \u043a \u0432\u0430\u043c.",
        _order_push_data(order),
    )


def schedule_client_order_completed_notification(order: Order) -> None:
    schedule_push_to_client(
        order.client_id,
        "\u0417\u0430\u043a\u0430\u0437 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d",
        "\u0412\u0430\u0448 \u0437\u0430\u043a\u0430\u0437 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d. \u0421\u043f\u0430\u0441\u0438\u0431\u043e, \u0447\u0442\u043e \u0432\u044b\u0431\u0440\u0430\u043b\u0438 \u0414\u0430\u0440\u043c\u0430\u0432\u043e\u0437.",
        _order_push_data(order),
    )


def schedule_driver_new_order_notification(order: Order, driver_id: UUID) -> None:
    schedule_push_to_driver(
        driver_id,
        "\u041d\u043e\u0432\u044b\u0439 \u0437\u0430\u043a\u0430\u0437",
        "\u041f\u043e\u0441\u0442\u0443\u043f\u0438\u043b \u043d\u043e\u0432\u044b\u0439 \u0437\u0430\u043a\u0430\u0437. \u041e\u0442\u043a\u0440\u043e\u0439\u0442\u0435 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u0438 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u0440\u0435\u0448\u0435\u043d\u0438\u0435.",
        _order_push_data(order),
    )


def schedule_driver_order_changed_notification(order: Order, driver_id: UUID) -> None:
    schedule_push_to_driver(
        driver_id,
        "\u0418\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0435 \u0437\u0430\u043a\u0430\u0437\u0430",
        "\u041f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u044b \u0437\u0430\u043a\u0430\u0437\u0430 \u0431\u044b\u043b\u0438 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u044b. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u0430\u043a\u0442\u0443\u0430\u043b\u044c\u043d\u044b\u0435 \u0434\u0430\u043d\u043d\u044b\u0435 \u0432 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0438.",
        _order_push_data(order),
    )


def schedule_driver_order_reminder_notification(order: Order, driver_id: UUID) -> None:
    schedule_push_to_driver(
        driver_id,
        "\u041d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u0435 \u043f\u043e \u0437\u0430\u043a\u0430\u0437\u0443",
        "\u0423 \u0432\u0430\u0441 \u0435\u0441\u0442\u044c \u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0439 \u0437\u0430\u043a\u0430\u0437. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u0442\u0435\u043a\u0443\u0449\u0438\u0439 \u044d\u0442\u0430\u043f \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f.",
        _order_push_data(order),
    )


def schedule_logist_driver_cancelled_notification(order: Order, driver_id: UUID, reason: str) -> None:
    schedule_push_to_logists(
        "\u041e\u0442\u043a\u0430\u0437 \u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044f",
        f"{_format_order_label(order)}: \u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044c {driver_id} \u043e\u0442\u043a\u0430\u0437\u0430\u043b\u0441\u044f \u043e\u0442 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f. \u041f\u0440\u0438\u0447\u0438\u043d\u0430: {reason}",
        {
            **_order_push_data(order),
            "driver_id": str(driver_id),
            "reason": reason,
            "event": "driver_cancel",
        },
    )


def schedule_logist_timeout_notification(order: Order, driver_id: UUID) -> None:
    schedule_push_to_logists(
        "\u0422\u0430\u0439\u043c\u0430\u0443\u0442 \u043e\u0442\u0432\u0435\u0442\u0430 \u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044f",
        f"{_format_order_label(order)}: \u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044c {driver_id} \u043d\u0435 \u043e\u0442\u0432\u0435\u0442\u0438\u043b \u0432 \u043e\u0442\u0432\u0435\u0434\u0435\u043d\u043d\u043e\u0435 \u0432\u0440\u0435\u043c\u044f.",
        {
            **_order_push_data(order),
            "driver_id": str(driver_id),
            "event": "timeout",
        },
    )


def schedule_logist_no_driver_found_notification(order: Order) -> None:
    schedule_push_to_logists(
        "\u0417\u0430\u043a\u0430\u0437 \u0431\u0435\u0437 \u0438\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044f",
        f"{_format_order_label(order)} \u043e\u0441\u0442\u0430\u043b\u0441\u044f \u0431\u0435\u0437 \u0438\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044f. \u0422\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044f \u0440\u0443\u0447\u043d\u0430\u044f \u043e\u0431\u0440\u0430\u0431\u043e\u0442\u043a\u0430 \u043b\u043e\u0433\u0438\u0441\u0442\u043e\u043c.",
        {
            **_order_push_data(order),
            "event": "no_driver_found",
        },
    )
