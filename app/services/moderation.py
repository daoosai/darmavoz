from __future__ import annotations

from collections.abc import Mapping
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any
from uuid import UUID

from fastapi import BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.models import ModerationAuditLog, ModerationStatus
from app.services.email_service import send_email

QUARRY_ENTITY_TYPE = "quarry"
EQUIPMENT_ENTITY_TYPE = "equipment"
PUBLICLY_VISIBLE_MODERATION_STATUSES = {
    ModerationStatus.approved.value,
    ModerationStatus.has_pending_changes.value,
}


def serialize_moderation_value(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if hasattr(value, "model_dump"):
        return serialize_moderation_value(value.model_dump())
    if isinstance(value, Mapping):
        return {
            str(key): serialize_moderation_value(item)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple, set)):
        return [serialize_moderation_value(item) for item in value]
    return value


def normalize_pending_changes(changes: Mapping[str, Any] | None) -> dict[str, Any]:
    if not changes:
        return {}
    return {
        str(key): serialize_moderation_value(value)
        for key, value in changes.items()
    }


def summarize_pending_changes(changes: Mapping[str, Any] | None) -> str | None:
    normalized = normalize_pending_changes(changes)
    if not normalized:
        return None
    return ", ".join(sorted(normalized))


def has_publicly_visible_moderation_status(status_value: str | None) -> bool:
    return bool(status_value in PUBLICLY_VISIBLE_MODERATION_STATUSES)


def mark_entity_pending_changes(entity: Any, changes: Mapping[str, Any]) -> dict[str, Any]:
    merged = normalize_pending_changes(entity.pending_changes or {})
    merged.update(normalize_pending_changes(changes))
    entity.pending_changes = merged or None
    if merged:
        entity.moderation_status = ModerationStatus.has_pending_changes.value
        entity.moderation_comment = None
        entity.moderated_at = None
        entity.moderated_by_user_id = None
    return merged


def clear_entity_pending_changes(entity: Any) -> None:
    entity.pending_changes = None


async def create_moderation_audit_log(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: UUID,
    user_id: UUID | None,
    action: str,
    comment: str | None = None,
) -> None:
    db.add(
        ModerationAuditLog(
            entity_type=entity_type,
            entity_id=entity_id,
            user_id=user_id,
            action=action,
            comment=comment,
        )
    )


def schedule_admin_moderation_email(
    background_tasks: BackgroundTasks,
    *,
    subject: str,
    body: str,
) -> None:
    if not settings.ADMIN_EMAIL:
        return
    background_tasks.add_task(
        send_email,
        to_email=settings.ADMIN_EMAIL,
        subject=subject,
        body=body,
    )
