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
from app.models.models import Client, Driver, Role, User

logger = logging.getLogger(__name__)
LOGIST_ROLE_NAMES = ("admin", "logist")


def _token_debug_suffix(token: str | None) -> str | None:
    if not token:
        return None
    normalized = token.strip()
    if not normalized:
        return None
    return normalized[:24]


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


def _send_push(token: str, title: str, body: str, data: dict[str, str] | None = None) -> str | None:
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
            headers={
                "apns-priority": "10",
                "apns-push-type": "alert",
            },
            payload=messaging.APNSPayload(
                aps=messaging.Aps(sound="default", content_available=True),
            ),
        ),
        webpush=messaging.WebpushConfig(
            headers={"Urgency": "high"},
            notification=messaging.WebpushNotification(
                title=title,
                body=body,
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

    token_debug = _token_debug_suffix(token)
    logger.info(
        "push_send_attempt",
        extra={
            f"{entity_name}_id": str(entity_id),
            "title": title,
            "token_prefix": token_debug,
            "push_data": data or {},
        },
    )

    try:
        message_id = await asyncio.to_thread(_send_push, token, title, body, data)
        logger.info(
            "push_sent",
            extra={
                f"{entity_name}_id": str(entity_id),
                "message_id": message_id,
                "title": title,
                "token_prefix": token_debug,
                "push_data": data or {},
            },
        )
        return True
    except Exception as exc:
        if _looks_like_invalid_token_error(exc):
            await clear_token()
            logger.warning(
                "push_token_invalidated",
                extra={
                    f"{entity_name}_id": str(entity_id),
                    "title": title,
                    "token_prefix": token_debug,
                },
            )
            return False

        logger.exception(
            "push_send_failed",
            extra={
                f"{entity_name}_id": str(entity_id),
                "title": title,
                "token_prefix": token_debug,
                "push_data": data or {},
            },
        )
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


async def send_push_to_user(
    user_id: UUID,
    title: str,
    body: str,
    data: dict[str, str] | None = None,
) -> bool:
    async with AsyncSessionLocal() as session:
        user = await session.scalar(select(User).where(User.id == user_id))
        if user is None:
            logger.warning("push_user_not_found", extra={"user_id": str(user_id)})
            return False

        async def clear_token() -> None:
            user.fcm_token = None
            await session.commit()

        return await _send_push_with_token_cleanup(
            entity_name="user",
            entity_id=user_id,
            token=user.fcm_token,
            clear_token=clear_token,
            title=title,
            body=body,
            data=data,
        )


async def send_push_to_logists(
    title: str,
    body: str,
    data: dict[str, str] | None = None,
) -> int:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(User)
            .join(Role, User.role_id == Role.id)
            .where(
                Role.name.in_(LOGIST_ROLE_NAMES),
                User.is_active.is_(True),
                User.fcm_token.is_not(None),
                User.fcm_token != "",
            )
        )
        users = list(result.scalars().unique().all())
        sent_count = 0
        seen_tokens: set[str] = set()

        for user in users:
            token = (user.fcm_token or "").strip()
            if not token or token in seen_tokens:
                continue
            seen_tokens.add(token)

            async def clear_token(current_user: User = user) -> None:
                current_user.fcm_token = None
                await session.flush()

            ok = await _send_push_with_token_cleanup(
                entity_name="logist_user",
                entity_id=user.id,
                token=token,
                clear_token=clear_token,
                title=title,
                body=body,
                data=data,
            )
            if ok:
                sent_count += 1

        await session.commit()
        return sent_count


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


def schedule_push_to_user(
    user_id: UUID,
    title: str,
    body: str,
    data: dict[str, str] | None = None,
) -> None:
    asyncio.create_task(
        send_push_to_user(user_id, title, body, data),
        name=f"push-user-{user_id}",
    )


def schedule_push_to_logists(
    title: str,
    body: str,
    data: dict[str, str] | None = None,
) -> None:
    asyncio.create_task(
        send_push_to_logists(title, body, data),
        name="push-logists",
    )
