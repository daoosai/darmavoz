from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import get_db
from app.models.models import PlacementStatus, Quarry, SpecialEquipmentListing, User
from app.schemas.placement import PlacementActionResult, PlacementPolicyOut, PlacementSummaryOut
from app.security.auth import (
    get_current_equipment_owner_user,
    get_current_logist_user,
    get_current_supplier_user,
)
from app.services.relevance import (
    archive_placement,
    confirm_relevance,
    extend_placement,
    hide_placement,
    restore_placement,
)


router = APIRouter()


async def _apply_pending_point_changes(db: AsyncSession, point: Quarry) -> None:
    if not point.pending_changes:
        return

    from app.api.admin_quarries import _apply_point_changes
    from app.schemas.quarry import QuarryUpdate

    pending_payload = QuarryUpdate.model_validate(point.pending_changes)
    await _apply_point_changes(db, point, pending_payload.model_dump(exclude_unset=True))


async def _apply_pending_equipment_changes(
    db: AsyncSession,
    listing: SpecialEquipmentListing,
) -> None:
    if not listing.pending_changes:
        return

    from app.api.equipment import _apply_listing_update_data, _normalize_listing_update_data
    from app.schemas.equipment import EquipmentListingUpdate

    pending_payload = EquipmentListingUpdate.model_validate(listing.pending_changes)
    pending_data = await _normalize_listing_update_data(db, pending_payload)
    _apply_listing_update_data(listing, pending_data)


def _policy() -> PlacementPolicyOut:
    return PlacementPolicyOut(
        trial_days=settings.PLACEMENT_TRIAL_DAYS,
        extension_days=settings.PLACEMENT_EXTENSION_DAYS,
        confirmation_interval_days=settings.PLACEMENT_CONFIRMATION_INTERVAL_DAYS,
        confirmation_grace_days=settings.PLACEMENT_CONFIRMATION_GRACE_DAYS,
    )


def _action_result(entity: Quarry | SpecialEquipmentListing) -> PlacementActionResult:
    return PlacementActionResult(
        placement_status=entity.placement_status,
        placement_ends_at=entity.placement_ends_at,
        next_confirmation_at=entity.next_confirmation_at,
    )


async def _point_or_404(db: AsyncSession, point_id: UUID) -> Quarry:
    point = await db.get(Quarry, point_id)
    if point is None:
        raise HTTPException(status_code=404, detail="Точка не найдена")
    return point


async def _equipment_or_404(db: AsyncSession, listing_id: UUID) -> SpecialEquipmentListing:
    listing = await db.get(SpecialEquipmentListing, listing_id)
    if listing is None or listing.is_deleted:
        raise HTTPException(status_code=404, detail="Объявление спецтехники не найдено")
    return listing


async def _commit_action(db: AsyncSession, entity) -> PlacementActionResult:
    await db.commit()
    await db.refresh(entity)
    return _action_result(entity)


@router.get("/admin/placements/summary", response_model=PlacementSummaryOut)
async def placement_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> PlacementSummaryOut:
    del current_user
    statuses = [item.value for item in PlacementStatus]
    by_entity = {
        "quarry": {item: 0 for item in statuses},
        "accumulator": {item: 0 for item in statuses},
        "equipment": {item: 0 for item in statuses},
    }
    point_rows = (
        await db.execute(
            select(Quarry.point_type, Quarry.placement_status, func.count(Quarry.id)).group_by(
                Quarry.point_type, Quarry.placement_status
            )
        )
    ).all()
    for point_type, placement_status, count in point_rows:
        if point_type in by_entity:
            by_entity[point_type][placement_status] = int(count)
    equipment_rows = (
        await db.execute(
            select(SpecialEquipmentListing.placement_status, func.count(SpecialEquipmentListing.id))
            .where(SpecialEquipmentListing.is_deleted.is_(False))
            .group_by(SpecialEquipmentListing.placement_status)
        )
    ).all()
    for placement_status, count in equipment_rows:
        by_entity["equipment"][placement_status] = int(count)
    totals = {
        placement_status: sum(group[placement_status] for group in by_entity.values())
        for placement_status in statuses
    }
    visible_statuses = (
        PlacementStatus.active.value,
        PlacementStatus.trial.value,
        PlacementStatus.confirmation_required.value,
    )
    return PlacementSummaryOut(
        generated_at=datetime.now(UTC),
        policy=_policy(),
        totals=totals,
        by_entity=by_entity,
        active_quarries=sum(by_entity["quarry"][item] for item in visible_statuses),
        active_accumulators=sum(by_entity["accumulator"][item] for item in visible_statuses),
        active_equipment=sum(by_entity["equipment"][item] for item in visible_statuses),
    )


async def _admin_point_action(db, point_id, current_user, action) -> PlacementActionResult:
    point = await _point_or_404(db, point_id)
    if action is extend_placement:
        await _apply_pending_point_changes(db, point)
    await action(db, point, actor_user_id=current_user.id)
    return await _commit_action(db, point)


async def _admin_equipment_action(db, listing_id, current_user, action) -> PlacementActionResult:
    listing = await _equipment_or_404(db, listing_id)
    if action is extend_placement:
        await _apply_pending_equipment_changes(db, listing)
    await action(db, listing, actor_user_id=current_user.id)
    return await _commit_action(db, listing)


@router.post("/admin/pickup-points/{point_id}/placement/extend", response_model=PlacementActionResult)
async def extend_point(point_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_logist_user)):
    return await _admin_point_action(db, point_id, current_user, extend_placement)


@router.post("/admin/pickup-points/{point_id}/placement/hide", response_model=PlacementActionResult)
async def hide_point(point_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_logist_user)):
    return await _admin_point_action(db, point_id, current_user, hide_placement)


@router.post("/admin/pickup-points/{point_id}/placement/restore", response_model=PlacementActionResult)
async def restore_point(point_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_logist_user)):
    return await _admin_point_action(db, point_id, current_user, restore_placement)


@router.post("/admin/pickup-points/{point_id}/placement/archive", response_model=PlacementActionResult)
async def archive_point(point_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_logist_user)):
    return await _admin_point_action(db, point_id, current_user, archive_placement)


@router.post("/admin/equipment/{listing_id}/placement/extend", response_model=PlacementActionResult)
async def extend_equipment(listing_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_logist_user)):
    return await _admin_equipment_action(db, listing_id, current_user, extend_placement)


@router.post("/admin/equipment/{listing_id}/placement/hide", response_model=PlacementActionResult)
async def hide_equipment(listing_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_logist_user)):
    return await _admin_equipment_action(db, listing_id, current_user, hide_placement)


@router.post("/admin/equipment/{listing_id}/placement/restore", response_model=PlacementActionResult)
async def restore_equipment(listing_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_logist_user)):
    return await _admin_equipment_action(db, listing_id, current_user, restore_placement)


@router.post("/admin/equipment/{listing_id}/placement/archive", response_model=PlacementActionResult)
async def archive_equipment(listing_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_logist_user)):
    return await _admin_equipment_action(db, listing_id, current_user, archive_placement)


async def _confirm_owned(db, entity, current_user) -> PlacementActionResult:
    if entity.owner_user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Размещение не найдено")
    await confirm_relevance(db, entity, actor_user_id=current_user.id)
    return await _commit_action(db, entity)


@router.post("/supplier/points/{point_id}/confirm-relevance", response_model=PlacementActionResult)
async def confirm_supplier_point(point_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_supplier_user)):
    return await _confirm_owned(db, await _point_or_404(db, point_id), current_user)


@router.post("/supplier/equipment/{listing_id}/confirm-relevance", response_model=PlacementActionResult)
async def confirm_supplier_equipment(listing_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_supplier_user)):
    return await _confirm_owned(db, await _equipment_or_404(db, listing_id), current_user)


@router.post("/equipment-owner/equipment/{listing_id}/confirm-relevance", response_model=PlacementActionResult)
async def confirm_owner_equipment(listing_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_equipment_owner_user)):
    return await _confirm_owned(db, await _equipment_or_404(db, listing_id), current_user)
