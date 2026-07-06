from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from uuid import UUID

import firebase_admin
from firebase_admin import credentials, messaging
from sqlalchemy import select

from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models.models import Client, Driver

logger = logging.getLogger(__name__)


def _get_firebase_credentials_path() -> Path | None:
    for candidate in settings.firebase_credentials_candidates:
        if candidate.exists():
            return candidate
    return None


def _get_firebase_app():
    try:
        return firebase_admin.get_app()
    except ValueError:
        credentials_path = _get_firebase_credentials_path()
        if credentials_path is None:
            logger.warning("firebase_credentials_missing")
            return None
        return firebase_admin.initialize_app(credentials.Certificate(str(credentials_path)))


def _send_push(
    token: str,
    title: str,
    body: str,
    data: dict[str, str] | None = None,
) -> str | None:
    app = _get_firebase_app()
    if app is None:
        return None
    message = messaging.Message(
        token=token,
        notification=messaging.Notification(title=title, body=body),
        data=data or {},
        android=messaging.AndroidConfig(
            notification=messaging.AndroidNotification(sound="default"),
        ),
        apns=messaging.APNSConfig(
            payload=messaging.APNSPayload(
                aps=messaging.Aps(sound="default"),
            ),
        ),
    )
    return messaging.send(message, app=app)


def _looks_like_invalid_token_error(exc: Exception) -> bool:
    class_name = exc.__class__.__name__.lower()
    message = str(exc).lower()
    invalid_markers = (
        "unregistered",
        "registration token is not a valid fcm registration token",
        "requested entity was not found",
        "invalid registration token",
        "sender id mismatch",
    )
    return (
        "unregistered" in class_name
        or "invalidargument" in class_name
        or "senderidmismatch" in class_name
        or any(marker in message for marker in invalid_markers)
    )


async def _send_push_with_token_cleanup(
    *,
    entity_name: str,
    entity_id: UUID,
    token: str | None,
    clear_token,
    title: str,
    body: str,
    data: dict[str, str] | None = None,
) -> bool:
    if not token:
        logger.info("push_token_missing", extra={f"{entity_name}_id": str(entity_id)})
        return False

    try:
        message_id = await asyncio.to_thread(_send_push, token, title, body, data)
        logger.info(
            "push_sent",
            extra={f"{entity_name}_id": str(entity_id), "message_id": message_id},
        )
        return True
    except Exception as exc:
        if _looks_like_invalid_token_error(exc):
            await clear_token()
            logger.warning(
                "push_token_invalidated",
                extra={f"{entity_name}_id": str(entity_id)},
            )
            return False

        logger.exception("push_send_failed", extra={f"{entity_name}_id": str(entity_id)})
        return False


async def send_push_to_driver(
    driver_id: UUID,
    title: str,
    body: str,
    data: dict[str, str] | None = None,
) -> bool:
    async with AsyncSessionLocal() as session:
        driver = await session.scalar(select(Driver).where(Driver.id == driver_id))
        if driver is None:
            logger.warning("push_driver_not_found", extra={"driver_id": str(driver_id)})
            return False

        async def clear_token() -> None:
            driver.fcm_token = None
            await session.commit()

        return await _send_push_with_token_cleanup(
            entity_name="driver",
            entity_id=driver_id,
            token=driver.fcm_token,
            clear_token=clear_token,
            title=title,
            body=body,
            data=data,
        )


async def send_push_to_client(
    client_id: UUID,
    title: str,
    body: str,
    data: dict[str, str] | None = None,
) -> bool:
    async with AsyncSessionLocal() as session:
        client = await session.scalar(select(Client).where(Client.id == client_id))
        if client is None:
            logger.warning("push_client_not_found", extra={"client_id": str(client_id)})
            return False

        async def clear_token() -> None:
            client.fcm_token = None
            await session.commit()

        return await _send_push_with_token_cleanup(
            entity_name="client",
            entity_id=client_id,
            token=client.fcm_token,
            clear_token=clear_token,
            title=title,
            body=body,
            data=data,
        )


def schedule_push_to_driver(
    driver_id: UUID,
    title: str,
    body: str,
    data: dict[str, str] | None = None,
) -> None:
    asyncio.create_task(
        send_push_to_driver(driver_id, title, body, data),
        name=f"push-driver-{driver_id}",
    )


def schedule_push_to_client(
    client_id: UUID,
    title: str,
    body: str,
    data: dict[str, str] | None = None,
) -> None:
    asyncio.create_task(
        send_push_to_client(client_id, title, body, data),
        name=f"push-client-{client_id}",
    )
