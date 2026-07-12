from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Client, Driver, User

logger = logging.getLogger(__name__)


async def detach_fcm_token_from_other_entities(
    db: AsyncSession,
    token: str,
    *,
    keep_user_id: UUID | None = None,
    keep_client_id: UUID | None = None,
    keep_driver_id: UUID | None = None,
) -> None:
    normalized_token = token.strip()
    if not normalized_token:
        return

    token_prefix = normalized_token[:24]
    logger.info(
        "fcm_token_detach_started",
        extra={
            "token_prefix": token_prefix,
            "keep_user_id": str(keep_user_id) if keep_user_id else None,
            "keep_client_id": str(keep_client_id) if keep_client_id else None,
            "keep_driver_id": str(keep_driver_id) if keep_driver_id else None,
        },
    )

    user_stmt = update(User).where(User.fcm_token == normalized_token)
    if keep_user_id is not None:
        user_stmt = user_stmt.where(User.id != keep_user_id)
    user_result = await db.execute(user_stmt.values(fcm_token=None))

    client_stmt = update(Client).where(Client.fcm_token == normalized_token)
    if keep_client_id is not None:
        client_stmt = client_stmt.where(Client.id != keep_client_id)
    client_result = await db.execute(client_stmt.values(fcm_token=None))

    driver_stmt = update(Driver).where(Driver.fcm_token == normalized_token)
    if keep_driver_id is not None:
        driver_stmt = driver_stmt.where(Driver.id != keep_driver_id)
    driver_result = await db.execute(driver_stmt.values(fcm_token=None))

    logger.info(
        "fcm_token_detach_finished",
        extra={
            "token_prefix": token_prefix,
            "detached_users": user_result.rowcount or 0,
            "detached_clients": client_result.rowcount or 0,
            "detached_drivers": driver_result.rowcount or 0,
        },
    )
