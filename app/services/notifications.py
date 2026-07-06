from __future__ import annotations

import asyncio
import logging
from uuid import UUID

from sqlalchemy import select

from app.db.database import AsyncSessionLocal
from app.models.models import Order, Role, User
from app.services.email_service import send_email
from app.services.push_service import schedule_push_to_client, schedule_push_to_driver

logger = logging.getLogger(__name__)


def _order_push_data(order: Order) -> dict[str, str]:
    return {
        "order_id": str(order.id),
        "status": str(order.status),
    }


def _format_order_label(order: Order) -> str:
    return f"Заказ {order.id}"


async def _send_email_to_logists(subject: str, body: str) -> None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(User.email)
            .join(Role, User.role_id == Role.id)
            .where(Role.name.in_(("admin", "logist")), User.is_active.is_(True), User.email.is_not(None))
        )
        emails = [email for email in result.scalars().all() if email]

    if not emails:
        logger.info("logist_notification_skipped_no_emails")
        return

    await asyncio.gather(
        *(asyncio.to_thread(send_email, to_email=email, subject=subject, body=body) for email in emails)
    )


def schedule_client_order_created_notification(order: Order) -> None:
    schedule_push_to_client(
        order.client_id,
        "Заказ создан",
        "Ваш заказ создан. Мы уже ищем исполнителя.",
        _order_push_data(order),
    )


def schedule_client_driver_assigned_notification(order: Order) -> None:
    schedule_push_to_client(
        order.client_id,
        "Водитель назначен",
        "Для вашего заказа назначен водитель. Статус обновлен в приложении.",
        _order_push_data(order),
    )


def schedule_client_heading_to_client_notification(order: Order) -> None:
    schedule_push_to_client(
        order.client_id,
        "Водитель выехал",
        "Водитель загрузился и выехал к вам.",
        _order_push_data(order),
    )


def schedule_client_order_completed_notification(order: Order) -> None:
    schedule_push_to_client(
        order.client_id,
        "Заказ завершен",
        "Ваш заказ завершен. Спасибо, что выбрали Дармавоз.",
        _order_push_data(order),
    )


def schedule_driver_new_order_notification(order: Order, driver_id: UUID) -> None:
    schedule_push_to_driver(
        driver_id,
        "Новый заказ",
        "Поступил новый заказ. Откройте приложение и подтвердите решение.",
        _order_push_data(order),
    )


def schedule_driver_order_changed_notification(order: Order, driver_id: UUID) -> None:
    schedule_push_to_driver(
        driver_id,
        "Изменение заказа",
        "Параметры заказа были обновлены. Проверьте актуальные данные в приложении.",
        _order_push_data(order),
    )


def schedule_driver_order_reminder_notification(order: Order, driver_id: UUID) -> None:
    schedule_push_to_driver(
        driver_id,
        "Напоминание по заказу",
        "У вас есть активный заказ. Проверьте текущий этап выполнения.",
        _order_push_data(order),
    )


def schedule_logist_driver_cancelled_notification(order: Order, driver_id: UUID, reason: str) -> None:
    asyncio.create_task(
        _send_email_to_logists(
            "Дармавоз: отказ водителя",
            (
                f"{_format_order_label(order)}: водитель {driver_id} отказался от выполнения.\n"
                f"Причина: {reason}"
            ),
        ),
        name=f"logist-driver-cancel-{order.id}",
    )


def schedule_logist_timeout_notification(order: Order, driver_id: UUID) -> None:
    asyncio.create_task(
        _send_email_to_logists(
            "Дармавоз: таймаут ответа водителя",
            f"{_format_order_label(order)}: водитель {driver_id} не ответил в отведенное время.",
        ),
        name=f"logist-timeout-{order.id}",
    )


def schedule_logist_no_driver_found_notification(order: Order) -> None:
    asyncio.create_task(
        _send_email_to_logists(
            "Дармавоз: заказ без исполнителя",
            f"{_format_order_label(order)} остался без исполнителя. Требуется ручная обработка логистом.",
        ),
        name=f"logist-no-driver-{order.id}",
    )
