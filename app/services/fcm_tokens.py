from __future__ import annotations

from uuid import UUID

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Client, Driver, User


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

    user_stmt = update(User).where(User.fcm_token == normalized_token)
    if keep_user_id is not None:
        user_stmt = user_stmt.where(User.id != keep_user_id)
    await db.execute(user_stmt.values(fcm_token=None))

    client_stmt = update(Client).where(Client.fcm_token == normalized_token)
    if keep_client_id is not None:
        client_stmt = client_stmt.where(Client.id != keep_client_id)
    await db.execute(client_stmt.values(fcm_token=None))

    driver_stmt = update(Driver).where(Driver.fcm_token == normalized_token)
    if keep_driver_id is not None:
        driver_stmt = driver_stmt.where(Driver.id != keep_driver_id)
    await db.execute(driver_stmt.values(fcm_token=None))
