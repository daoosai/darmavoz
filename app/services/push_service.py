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
from app.models.models import Driver

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


def _send_push(token: str, title: str, body: str) -> str | None:
    app = _get_firebase_app()
    if app is None:
        return None
    message = messaging.Message(
        token=token,
        notification=messaging.Notification(title=title, body=body),
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


async def send_push_to_driver(driver_id: UUID, title: str, body: str) -> bool:
    async with AsyncSessionLocal() as session:
        driver = await session.scalar(select(Driver).where(Driver.id == driver_id))
        if driver is None:
            logger.warning("push_driver_not_found", extra={"driver_id": str(driver_id)})
            return False
        if not driver.fcm_token:
            logger.info("push_token_missing", extra={"driver_id": str(driver_id)})
            return False

        try:
            message_id = await asyncio.to_thread(_send_push, driver.fcm_token, title, body)
            logger.info(
                "push_sent",
                extra={"driver_id": str(driver_id), "message_id": message_id},
            )
            return True
        except Exception:
            logger.exception("push_send_failed", extra={"driver_id": str(driver_id)})
            return False


def schedule_push_to_driver(driver_id: UUID, title: str, body: str) -> None:
    asyncio.create_task(send_push_to_driver(driver_id, title, body), name=f"push-driver-{driver_id}")
