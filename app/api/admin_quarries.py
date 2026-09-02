import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin import DeleteResult
from app.db.database import get_db
from app.models.models import (
    CartItem,
    CrmStatus,
    MediaFile,
    ModerationStatus,
    PlacementStatus,
    Order,
    Quarry,
    User,
    quarry_delivery_options,
    quarry_materials,
)
from app.schemas.quarry import (
    AdminPickupPointOut,
    ModerationDecision,
    QuarryCreate,
    QuarryMaterialOfferIn,
    QuarryUpdate,
    RejectionDecision,
)
from app.schemas.bulk import BulkDeleteRequest, BulkDeleteResult
from app.security.auth import get_current_admin_user, get_current_logist_user
from app.services.pickup_points import (
    default_delivery_option_ids,
    default_min_delivery_price,
    pickup_point_payload,
    sync_delivery_options,
    sync_material_offers,
    validate_point_can_be_approved,
)
from app.services.moderation import (
    QUARRY_ENTITY_TYPE,
    clear_entity_pending_changes,
    create_moderation_audit_log,
    summarize_pending_changes,
)
from app.services.relevance import (
    apply_manual_placement_end_date,
    initialize_trial,
    recalculate_status,
)

router = APIRouter()
logger = logging.getLogger(__name__)
ACTIVATION_ERROR = "Невозможно активировать точку: отсутствуют материалы, цены или фото"


async def _admin_pickup_point_payload(db: AsyncSession, point: Quarry) -> dict:
    return await pickup_point_payload(
        db,
        point,
        include_owner_contacts=True,
        include_pending_changes=True,
    )


async def _get_point_or_404(db: AsyncSession, point_id: UUID) -> Quarry:
    point = await db.get(Quarry, point_id)
    if point is None:
        raise HTTPException(status_code=404, detail="Pickup point not found")
    return point


async def _validate_point_activation(db: AsyncSession, point: Quarry) -> None:
    try:
        await validate_point_can_be_approved(db, point)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_400_BAD_REQUEST:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=ACTIVATION_ERROR,
            ) from exc
        raise


async def _apply_point_changes(
    db: AsyncSession,
    point: Quarry,
    payload_data: dict,
) -> None:
    for nullable_field in ("description", "contact_phone", "subscription_end_date", "short_name"):
        if nullable_field in payload_data and isinstance(payload_data[nullable_field], str):
            normalized = payload_data[nullable_field].strip()
            payload_data[nullable_field] = normalized or None
    if "name" in payload_data and "short_name" not in payload_data:
        payload_data["short_name"] = payload_data["name"]
    elif "short_name" in payload_data and not payload_data["short_name"]:
        payload_data["short_name"] = payload_data.get("name") or point.name
    changed = set(payload_data)
    for field in (
        "name",
        "short_name",
        "point_type",
        "address",
        "description",
        "contact_phone",
        "subscription_end_date",
        "lat",
        "lon",
        "min_delivery_price",
        "is_vip",
        "manual_priority",
        "is_active",
    ):
        if field in changed:
            setattr(point, field, payload_data[field])
    if "subscription_end_date" in changed:
        point.placement_ends_at = point.subscription_end_date

    if "point_type" in changed and "min_delivery_price" not in changed:
        point.min_delivery_price = default_min_delivery_price(point.point_type)
    if "material_offers" in changed or "material_ids" in changed:
        await sync_material_offers(
            db,
            quarry_id=point.id,
            offers=payload_data.get("material_offers"),
            legacy_material_ids=payload_data.get("material_ids"),
        )
    if "delivery_option_ids" in changed:
        await sync_delivery_options(
            db,
            quarry_id=point.id,
            delivery_option_ids=payload_data.get("delivery_option_ids") or [],
        )
    elif "point_type" in changed:
        await sync_delivery_options(
            db,
            quarry_id=point.id,
            delivery_option_ids=await default_delivery_option_ids(db, point.point_type),
        )


@router.get("/quarries", response_model=list[AdminPickupPointOut])
@router.get("/pickup-points", response_model=list[AdminPickupPointOut])
async def list_pickup_points(
    moderation_status: str | None = None,
    placement_status: PlacementStatus | None = None,
    crm_status: CrmStatus | None = None,
    point_type: str | None = None,
    material_id: UUID | None = None,
    search: str | None = Query(default=None, max_length=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> list[dict]:
    del current_user
    stmt = select(Quarry)
    if moderation_status:
        if moderation_status == ModerationStatus.pending_moderation.value:
            stmt = stmt.where(
                Quarry.moderation_status.in_(
                    [
                        ModerationStatus.pending_moderation.value,
                        ModerationStatus.has_pending_changes.value,
                    ]
                )
            )
        else:
            stmt = stmt.where(Quarry.moderation_status == moderation_status)
    if placement_status is not None:
        stmt = stmt.where(Quarry.placement_status == placement_status.value)
    if crm_status is not None:
        stmt = stmt.where(Quarry.crm_status == crm_status.value)
    if point_type:
        stmt = stmt.where(Quarry.point_type == point_type)
    if material_id:
        stmt = stmt.join(
            quarry_materials, quarry_materials.c.quarry_id == Quarry.id
        ).where(
            quarry_materials.c.material_id == material_id,
            quarry_materials.c.is_active.is_(True),
        )
    if search:
        stmt = stmt.where(Quarry.name.ilike(f"%{search.strip()}%"))
    points = list((await db.execute(stmt.order_by(Quarry.name.asc()))).scalars().all())
    return [await _admin_pickup_point_payload(db, point) for point in points]


@router.get("/quarries/{point_id}", response_model=AdminPickupPointOut)
@router.get("/pickup-points/{point_id}", response_model=AdminPickupPointOut)
async def get_pickup_point(
    point_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> dict:
    del current_user
    return await _admin_pickup_point_payload(db, await _get_point_or_404(db, point_id))


@router.post("/quarries", response_model=AdminPickupPointOut, status_code=status.HTTP_201_CREATED)
@router.post("/pickup-points", response_model=AdminPickupPointOut, status_code=status.HTTP_201_CREATED)
async def create_pickup_point(
    payload: QuarryCreate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
) -> dict:
    min_price = payload.min_delivery_price
    if min_price is None:
        min_price = default_min_delivery_price(payload.point_type)
    short_name = payload.short_name or payload.name
    point = Quarry(
        name=payload.name,
        short_name=short_name,
        point_type=payload.point_type,
        address=payload.address,
        description=payload.description,
        contact_phone=payload.contact_phone,
        subscription_end_date=payload.subscription_end_date,
        placement_ends_at=payload.subscription_end_date,
        lat=payload.lat,
        lon=payload.lon,
        min_delivery_price=min_price,
        is_vip=payload.is_vip,
        manual_priority=payload.manual_priority,
        is_active=payload.is_active,
        moderation_status=ModerationStatus.incomplete.value,
        moderated_by_user_id=current_admin.id,
        moderated_at=datetime.now(timezone.utc),
    )
    db.add(point)
    await db.flush()
    await sync_material_offers(
        db,
        quarry_id=point.id,
        offers=payload.material_offers,
        legacy_material_ids=payload.material_ids,
    )
    delivery_option_ids = payload.delivery_option_ids or await default_delivery_option_ids(
        db, payload.point_type
    )
    await sync_delivery_options(
        db, quarry_id=point.id, delivery_option_ids=delivery_option_ids
    )
    if point.is_active:
        try:
            await _validate_point_activation(db, point)
            point.moderation_status = ModerationStatus.approved.value
            if payload.subscription_end_date is not None:
                await apply_manual_placement_end_date(
                    db,
                    point,
                    ends_at=payload.subscription_end_date,
                    actor_user_id=current_admin.id,
                )
            else:
                await initialize_trial(db, point, actor_user_id=current_admin.id)
        except HTTPException:
            await db.rollback()
            raise
    await db.commit()
    await db.refresh(point)
    return await _admin_pickup_point_payload(db, point)


@router.patch("/quarries/{point_id}", response_model=AdminPickupPointOut)
@router.patch("/pickup-points/{point_id}", response_model=AdminPickupPointOut)
async def update_pickup_point(
    point_id: UUID,
    payload: QuarryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> dict:
    point = await _get_point_or_404(db, point_id)
    payload_data = payload.model_dump(exclude_unset=True)
    await _apply_point_changes(db, point, payload_data)
    changed = set(payload_data)
    if "subscription_end_date" in changed:
        await apply_manual_placement_end_date(
            db,
            point,
            ends_at=point.subscription_end_date,
            actor_user_id=current_user.id,
        )
        if point.is_active:
            try:
                await _validate_point_activation(db, point)
            except HTTPException:
                await db.rollback()
                raise
    publication_fields = {
        "is_active",
        "point_type",
        "min_delivery_price",
        "material_offers",
        "material_ids",
        "delivery_option_ids",
    }
    if point.is_active and changed.intersection(publication_fields):
        try:
            await _validate_point_activation(db, point)
            point.moderation_status = ModerationStatus.approved.value
            point.moderation_comment = None
            clear_entity_pending_changes(point)
            point.moderated_at = datetime.now(timezone.utc)
            point.moderated_by_user_id = current_user.id
            await initialize_trial(db, point, actor_user_id=current_user.id)
        except HTTPException:
            await db.rollback()
            raise
    await recalculate_status(
        db,
        point,
        actor_user_id=current_user.id,
        action="admin_pickup_point_updated",
    )
    await db.commit()
    await db.refresh(point)
    return await _admin_pickup_point_payload(db, point)


@router.put("/pickup-points/{point_id}/offers", response_model=AdminPickupPointOut)
async def replace_pickup_point_offers(
    point_id: UUID,
    offers: list[QuarryMaterialOfferIn],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> dict:
    del current_user
    point = await _get_point_or_404(db, point_id)
    await sync_material_offers(db, quarry_id=point.id, offers=offers)
    if point.is_active:
        try:
            await _validate_point_activation(db, point)
        except HTTPException:
            await db.rollback()
            raise
    await db.commit()
    return await _admin_pickup_point_payload(db, point)


@router.put("/pickup-points/{point_id}/delivery-options", response_model=AdminPickupPointOut)
async def replace_pickup_point_delivery_options(
    point_id: UUID,
    delivery_option_ids: list[UUID],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> dict:
    del current_user
    point = await _get_point_or_404(db, point_id)
    await sync_delivery_options(
        db, quarry_id=point.id, delivery_option_ids=delivery_option_ids
    )
    if point.is_active:
        try:
            await _validate_point_activation(db, point)
        except HTTPException:
            await db.rollback()
            raise
    await db.commit()
    return await _admin_pickup_point_payload(db, point)


@router.post("/pickup-points/{point_id}/approve", response_model=AdminPickupPointOut)
async def approve_pickup_point(
    point_id: UUID,
    payload: ModerationDecision,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> dict:
    point = await _get_point_or_404(db, point_id)
    try:
        staged_changes = point.pending_changes if point.moderation_status == ModerationStatus.has_pending_changes.value else None
        if staged_changes:
            pending_payload = QuarryUpdate.model_validate(staged_changes)
            await _apply_point_changes(
                db,
                point,
                pending_payload.model_dump(exclude_unset=True),
            )
        await validate_point_can_be_approved(db, point)
        point.moderation_status = ModerationStatus.approved.value
        point.moderation_comment = payload.comment
        point.moderated_at = datetime.now(timezone.utc)
        point.moderated_by_user_id = current_user.id
        if not staged_changes:
            point.is_active = True
        clear_entity_pending_changes(point)
        await initialize_trial(db, point, actor_user_id=current_user.id)
        await create_moderation_audit_log(
            db,
            entity_type=QUARRY_ENTITY_TYPE,
            entity_id=point.id,
            user_id=current_user.id,
            action="approved",
            comment=summarize_pending_changes(staged_changes) or payload.comment,
        )
        await db.commit()
        await db.refresh(point)
        return await _admin_pickup_point_payload(db, point)
    except HTTPException:
        await db.rollback()
        raise
    except SQLAlchemyError as exc:
        await db.rollback()
        logger.warning(
            "pickup_point_approval_failed",
            extra={"pickup_point_id": str(point_id)},
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Точку нельзя одобрить: проверьте материал и цену, фотографию и координаты"
            ),
        ) from exc


@router.post("/pickup-points/{point_id}/reject", response_model=AdminPickupPointOut)
async def reject_pickup_point(
    point_id: UUID,
    payload: RejectionDecision,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> dict:
    point = await _get_point_or_404(db, point_id)
    staged_changes = point.pending_changes if point.moderation_status == ModerationStatus.has_pending_changes.value else None
    if staged_changes:
        point.moderation_status = ModerationStatus.approved.value
        clear_entity_pending_changes(point)
    else:
        point.moderation_status = ModerationStatus.rejected.value
    point.moderation_comment = payload.reason
    point.moderated_at = datetime.now(timezone.utc)
    point.moderated_by_user_id = current_user.id
    await recalculate_status(db, point, actor_user_id=current_user.id, action="moderation_rejected")
    await create_moderation_audit_log(
        db,
        entity_type=QUARRY_ENTITY_TYPE,
        entity_id=point.id,
        user_id=current_user.id,
        action="rejected",
        comment=payload.reason,
    )
    await db.commit()
    return await _admin_pickup_point_payload(db, point)


@router.post("/pickup-points/{point_id}/suspend", response_model=AdminPickupPointOut)
async def suspend_pickup_point(
    point_id: UUID,
    payload: ModerationDecision,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> dict:
    point = await _get_point_or_404(db, point_id)
    point.moderation_status = ModerationStatus.suspended.value
    point.moderation_comment = payload.comment
    point.moderated_at = datetime.now(timezone.utc)
    point.moderated_by_user_id = current_user.id
    await recalculate_status(db, point, actor_user_id=current_user.id, action="moderation_suspended")
    await create_moderation_audit_log(
        db,
        entity_type=QUARRY_ENTITY_TYPE,
        entity_id=point.id,
        user_id=current_user.id,
        action="suspended",
        comment=payload.comment,
    )
    await db.commit()
    return await _admin_pickup_point_payload(db, point)


@router.delete("/quarries/{point_id}", response_model=DeleteResult)
@router.delete("/pickup-points/{point_id}", response_model=DeleteResult)
async def hide_pickup_point(
    point_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
) -> DeleteResult:
    del current_admin
    point = await _get_point_or_404(db, point_id)
    await db.execute(
        update(CartItem).where(CartItem.quarry_id == point.id).values(quarry_id=None)
    )
    await db.execute(
        update(Order).where(Order.quarry_id == point.id).values(quarry_id=None)
    )
    await db.execute(
        delete(quarry_materials).where(quarry_materials.c.quarry_id == point.id)
    )
    await db.execute(
        delete(quarry_delivery_options).where(
            quarry_delivery_options.c.quarry_id == point.id
        )
    )
    await db.execute(
        delete(MediaFile).where(
            MediaFile.entity_type == "quarry",
            MediaFile.entity_id == point.id,
        )
    )
    await db.delete(point)
    await db.commit()
    return DeleteResult(action="deleted", detail="Pickup point was deleted")


@router.post("/pickup-points/bulk-delete", response_model=BulkDeleteResult)
async def bulk_delete_pickup_points(
    payload: BulkDeleteRequest,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
) -> BulkDeleteResult:
    del current_admin
    point_ids = list(set(payload.point_ids))
    await db.execute(update(CartItem).where(CartItem.quarry_id.in_(point_ids)).values(quarry_id=None))
    await db.execute(update(Order).where(Order.quarry_id.in_(point_ids)).values(quarry_id=None))
    await db.execute(delete(quarry_materials).where(quarry_materials.c.quarry_id.in_(point_ids)))
    await db.execute(delete(quarry_delivery_options).where(quarry_delivery_options.c.quarry_id.in_(point_ids)))
    await db.execute(delete(MediaFile).where(MediaFile.entity_type == "quarry", MediaFile.entity_id.in_(point_ids)))
    deleted = await db.execute(delete(Quarry).where(Quarry.id.in_(point_ids)))
    await db.commit()
    return BulkDeleteResult(deleted_count=deleted.rowcount or 0)
