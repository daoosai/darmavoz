from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TypeAlias
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.models import (
    ModerationStatus,
    PlacementAuditLog,
    PlacementStatus,
    Quarry,
    SpecialEquipmentListing,
)
from app.services.moderation import clear_entity_pending_changes


PlacementEntity: TypeAlias = Quarry | SpecialEquipmentListing
PUBLIC_PLACEMENT_STATUSES = {
    PlacementStatus.active.value,
    PlacementStatus.trial.value,
    PlacementStatus.confirmation_required.value,
}
PUBLIC_MODERATION_STATUSES = {
    ModerationStatus.approved.value,
    ModerationStatus.has_pending_changes.value,
}
MANUAL_HIDDEN_REASON = "manual"
CONFIRMATION_OVERDUE_REASON = "confirmation_overdue"


def utcnow() -> datetime:
    return datetime.now(UTC)


def placement_entity_type(entity: PlacementEntity) -> str:
    return "pickup_point" if isinstance(entity, Quarry) else "equipment"


def confirmation_grace_ends_at(entity: PlacementEntity) -> datetime | None:
    if entity.next_confirmation_at is None:
        return None
    return entity.next_confirmation_at + timedelta(
        days=settings.PLACEMENT_CONFIRMATION_GRACE_DAYS
    )


def can_confirm_relevance(entity: PlacementEntity) -> bool:
    if entity.placement_status in {
        PlacementStatus.active.value,
        PlacementStatus.trial.value,
        PlacementStatus.confirmation_required.value,
    }:
        return True
    return (
        entity.placement_status == PlacementStatus.hidden.value
        and entity.placement_hidden_reason == CONFIRMATION_OVERDUE_REASON
    )


def public_placement_filters(model: type[Quarry] | type[SpecialEquipmentListing]):
    grace = timedelta(days=settings.PLACEMENT_CONFIRMATION_GRACE_DAYS)
    filters = [
        model.is_active.is_(True),
        model.moderation_status.in_(tuple(sorted(PUBLIC_MODERATION_STATUSES))),
        or_(
            model.placement_status.in_(tuple(sorted(PUBLIC_PLACEMENT_STATUSES))),
            (
                (model.placement_status == PlacementStatus.pending_moderation.value)
                & model.placement_started_at.is_(None)
            ),
        ),
        or_(model.placement_ends_at.is_(None), model.placement_ends_at > func.now()),
        or_(
            model.next_confirmation_at.is_(None),
            model.next_confirmation_at + grace > func.now(),
        ),
    ]
    if model is SpecialEquipmentListing:
        filters.append(model.is_deleted.is_(False))
    return tuple(filters)


def is_publicly_available(entity: PlacementEntity, *, now: datetime | None = None) -> bool:
    current_time = now or utcnow()
    if isinstance(entity, SpecialEquipmentListing) and entity.is_deleted:
        return False
    if not entity.is_active:
        return False
    if entity.moderation_status not in PUBLIC_MODERATION_STATUSES:
        return False
    is_legacy_approved = (
        entity.placement_status == PlacementStatus.pending_moderation.value
        and entity.placement_started_at is None
    )
    if entity.placement_status not in PUBLIC_PLACEMENT_STATUSES and not is_legacy_approved:
        return False
    if entity.placement_ends_at is not None and entity.placement_ends_at <= current_time:
        return False
    grace_ends_at = confirmation_grace_ends_at(entity)
    return grace_ends_at is None or grace_ends_at > current_time


def _sync_legacy_visibility(entity: PlacementEntity) -> None:
    entity.is_active = entity.placement_status in PUBLIC_PLACEMENT_STATUSES
    if isinstance(entity, Quarry):
        entity.subscription_end_date = entity.placement_ends_at


async def _transition(
    db: AsyncSession,
    entity: PlacementEntity,
    new_status: str,
    *,
    action: str,
    actor_user_id: UUID | None = None,
    reason: str | None = None,
    now: datetime | None = None,
) -> bool:
    current_time = now or utcnow()
    old_status = entity.placement_status
    entity.placement_status = new_status
    _sync_legacy_visibility(entity)
    if old_status == new_status:
        return False
    entity.placement_status_changed_at = current_time
    db.add(
        PlacementAuditLog(
            entity_type=placement_entity_type(entity),
            entity_id=entity.id,
            actor_user_id=actor_user_id,
            old_status=old_status,
            new_status=new_status,
            action=action,
            reason=reason,
        )
    )
    return True


def _trial_is_current(entity: PlacementEntity, now: datetime) -> bool:
    if entity.trial_ends_at is None or entity.trial_ends_at <= now:
        return False
    if entity.placement_ends_at is None:
        return False
    return entity.placement_ends_at == entity.trial_ends_at


async def initialize_trial(
    db: AsyncSession,
    entity: PlacementEntity,
    *,
    actor_user_id: UUID | None = None,
    now: datetime | None = None,
) -> None:
    if entity.placement_started_at is not None:
        await recalculate_status(
            db, entity, actor_user_id=actor_user_id, action="moderation_recalculated", now=now
        )
        return
    current_time = now or utcnow()
    trial_ends_at = current_time + timedelta(days=settings.PLACEMENT_TRIAL_DAYS)
    entity.placement_started_at = current_time
    entity.trial_ends_at = trial_ends_at
    entity.placement_ends_at = trial_ends_at
    entity.last_confirmed_at = current_time
    entity.next_confirmation_at = current_time + timedelta(
        days=settings.PLACEMENT_CONFIRMATION_INTERVAL_DAYS
    )
    entity.placement_hidden_reason = None
    await _transition(
        db,
        entity,
        PlacementStatus.trial.value,
        action="trial_started",
        actor_user_id=actor_user_id,
        now=current_time,
    )


async def recalculate_status(
    db: AsyncSession,
    entity: PlacementEntity,
    *,
    actor_user_id: UUID | None = None,
    action: str = "relevance_recalculated",
    now: datetime | None = None,
) -> str:
    current_time = now or utcnow()
    if entity.placement_status == PlacementStatus.archived.value:
        return entity.placement_status
    if entity.moderation_status not in PUBLIC_MODERATION_STATUSES:
        target = PlacementStatus.pending_moderation.value
    elif entity.placement_ends_at is not None and entity.placement_ends_at <= current_time:
        target = PlacementStatus.expired.value
    elif (
        entity.placement_status == PlacementStatus.hidden.value
        and entity.placement_hidden_reason == MANUAL_HIDDEN_REASON
    ):
        target = PlacementStatus.hidden.value
    else:
        grace_ends_at = confirmation_grace_ends_at(entity)
        if grace_ends_at is not None and grace_ends_at <= current_time:
            entity.placement_hidden_reason = CONFIRMATION_OVERDUE_REASON
            target = PlacementStatus.hidden.value
        elif entity.next_confirmation_at is not None and entity.next_confirmation_at <= current_time:
            entity.placement_hidden_reason = None
            target = PlacementStatus.confirmation_required.value
        elif _trial_is_current(entity, current_time):
            entity.placement_hidden_reason = None
            target = PlacementStatus.trial.value
        else:
            entity.placement_hidden_reason = None
            target = PlacementStatus.active.value
    await _transition(
        db,
        entity,
        target,
        action=action,
        actor_user_id=actor_user_id,
        now=current_time,
    )
    return target


async def confirm_relevance(
    db: AsyncSession,
    entity: PlacementEntity,
    *,
    actor_user_id: UUID,
    now: datetime | None = None,
) -> None:
    current_time = now or utcnow()
    await recalculate_status(db, entity, now=current_time)
    if not can_confirm_relevance(entity):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "PLACEMENT_CONFIRMATION_NOT_ALLOWED", "message": "???????????? ????? ?????????? ?????? ??????????? ??????"},
        )
    entity.last_confirmed_at = current_time
    entity.next_confirmation_at = current_time + timedelta(
        days=settings.PLACEMENT_CONFIRMATION_INTERVAL_DAYS
    )
    entity.placement_hidden_reason = None
    target = PlacementStatus.trial.value if _trial_is_current(entity, current_time) else PlacementStatus.active.value
    await _transition(
        db,
        entity,
        target,
        action="relevance_confirmed",
        actor_user_id=actor_user_id,
        now=current_time,
    )


async def extend_placement(
    db: AsyncSession,
    entity: PlacementEntity,
    *,
    actor_user_id: UUID,
    now: datetime | None = None,
) -> None:
    current_time = now or utcnow()
    base_time = max(current_time, entity.placement_ends_at or current_time)
    entity.placement_ends_at = base_time + timedelta(days=settings.PLACEMENT_EXTENSION_DAYS)
    if isinstance(entity, SpecialEquipmentListing):
        entity.expiration_notice_sent = False
    entity.moderation_status = ModerationStatus.approved.value
    entity.moderation_comment = None
    entity.moderated_at = current_time
    entity.moderated_by_user_id = actor_user_id
    clear_entity_pending_changes(entity)
    entity.last_confirmed_at = current_time
    entity.next_confirmation_at = current_time + timedelta(
        days=settings.PLACEMENT_CONFIRMATION_INTERVAL_DAYS
    )
    entity.placement_hidden_reason = None
    if entity.placement_started_at is None:
        entity.placement_started_at = current_time
    await _transition(
        db,
        entity,
        PlacementStatus.active.value,
        action="placement_extended",
        actor_user_id=actor_user_id,
        now=current_time,
    )
    _sync_legacy_visibility(entity)


async def apply_manual_placement_end_date(
    db: AsyncSession,
    entity: PlacementEntity,
    *,
    ends_at: datetime | None,
    actor_user_id: UUID | None = None,
    now: datetime | None = None,
) -> str:
    current_time = now or utcnow()
    preserve_manual_hide = (
        entity.placement_status == PlacementStatus.hidden.value
        and entity.placement_hidden_reason == MANUAL_HIDDEN_REASON
    )
    entity.placement_ends_at = ends_at
    if isinstance(entity, SpecialEquipmentListing):
        entity.expiration_notice_sent = False
    if isinstance(entity, Quarry):
        entity.subscription_end_date = ends_at
    if entity.placement_started_at is None:
        entity.placement_started_at = current_time
    entity.last_confirmed_at = current_time
    entity.next_confirmation_at = current_time + timedelta(
        days=settings.PLACEMENT_CONFIRMATION_INTERVAL_DAYS
    )
    if not preserve_manual_hide:
        entity.placement_hidden_reason = None
    return await recalculate_status(
        db,
        entity,
        actor_user_id=actor_user_id,
        action="manual_placement_date_updated",
        now=current_time,
    )


async def hide_placement(
    db: AsyncSession,
    entity: PlacementEntity,
    *,
    actor_user_id: UUID,
    now: datetime | None = None,
) -> None:
    entity.placement_hidden_reason = MANUAL_HIDDEN_REASON
    await _transition(
        db,
        entity,
        PlacementStatus.hidden.value,
        action="placement_hidden",
        actor_user_id=actor_user_id,
        reason=MANUAL_HIDDEN_REASON,
        now=now,
    )


async def archive_placement(
    db: AsyncSession,
    entity: PlacementEntity,
    *,
    actor_user_id: UUID,
    now: datetime | None = None,
) -> None:
    current_time = now or utcnow()
    entity.archived_at = current_time
    entity.placement_hidden_reason = None
    await _transition(
        db,
        entity,
        PlacementStatus.archived.value,
        action="placement_archived",
        actor_user_id=actor_user_id,
        now=current_time,
    )


async def restore_placement(
    db: AsyncSession,
    entity: PlacementEntity,
    *,
    actor_user_id: UUID,
    now: datetime | None = None,
) -> None:
    current_time = now or utcnow()
    entity.archived_at = None
    entity.placement_hidden_reason = None
    await _transition(
        db,
        entity,
        PlacementStatus.active.value,
        action="placement_restored",
        actor_user_id=actor_user_id,
        now=current_time,
    )
    await recalculate_status(
        db,
        entity,
        actor_user_id=actor_user_id,
        action="placement_restored_recalculated",
        now=current_time,
    )


def placement_payload_fields(entity: PlacementEntity) -> dict:
    return {
        "placement_status": entity.placement_status,
        "placement_started_at": entity.placement_started_at,
        "trial_ends_at": entity.trial_ends_at,
        "placement_ends_at": entity.placement_ends_at,
        "last_confirmed_at": entity.last_confirmed_at,
        "next_confirmation_at": entity.next_confirmation_at,
        "confirmation_grace_ends_at": confirmation_grace_ends_at(entity),
        "placement_hidden_reason": entity.placement_hidden_reason,
        "archived_at": entity.archived_at,
        "can_confirm_relevance": can_confirm_relevance(entity),
    }

