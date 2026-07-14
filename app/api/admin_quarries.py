from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin import DeleteResult
from app.db.database import get_db
from app.models.models import ModerationStatus, Quarry, User, quarry_materials
from app.schemas.quarry import (
    ModerationDecision,
    QuarryCreate,
    QuarryMaterialOfferIn,
    QuarryOut,
    QuarryUpdate,
    RejectionDecision,
)
from app.security.auth import get_current_admin_user, get_current_logist_user
from app.services.pickup_points import (
    default_delivery_option_ids,
    default_min_delivery_price,
    pickup_point_payload,
    sync_delivery_options,
    sync_material_offers,
    validate_point_can_be_approved,
)

router = APIRouter()


async def _get_point_or_404(db: AsyncSession, point_id: UUID) -> Quarry:
    point = await db.get(Quarry, point_id)
    if point is None:
        raise HTTPException(status_code=404, detail="Pickup point not found")
    return point


@router.get("/quarries", response_model=list[QuarryOut])
@router.get("/pickup-points", response_model=list[QuarryOut])
async def list_pickup_points(
    moderation_status: str | None = None,
    point_type: str | None = None,
    material_id: UUID | None = None,
    search: str | None = Query(default=None, max_length=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> list[dict]:
    del current_user
    stmt = select(Quarry)
    if moderation_status:
        stmt = stmt.where(Quarry.moderation_status == moderation_status)
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
    return [await pickup_point_payload(db, point) for point in points]


@router.get("/quarries/{point_id}", response_model=QuarryOut)
@router.get("/pickup-points/{point_id}", response_model=QuarryOut)
async def get_pickup_point(
    point_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> dict:
    del current_user
    return await pickup_point_payload(db, await _get_point_or_404(db, point_id))


@router.post("/quarries", response_model=QuarryOut, status_code=status.HTTP_201_CREATED)
@router.post("/pickup-points", response_model=QuarryOut, status_code=status.HTTP_201_CREATED)
async def create_pickup_point(
    payload: QuarryCreate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
) -> dict:
    min_price = payload.min_delivery_price
    if min_price is None:
        min_price = default_min_delivery_price(payload.point_type)
    point = Quarry(
        name=payload.name,
        short_name=payload.short_name,
        point_type=payload.point_type,
        address=payload.address,
        description=payload.description,
        lat=payload.lat,
        lon=payload.lon,
        min_delivery_price=min_price,
        is_active=payload.is_active,
        moderation_status=(
            ModerationStatus.approved.value
            if min_price is not None
            else ModerationStatus.incomplete.value
        ),
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
    await db.commit()
    await db.refresh(point)
    return await pickup_point_payload(db, point)


@router.patch("/quarries/{point_id}", response_model=QuarryOut)
@router.patch("/pickup-points/{point_id}", response_model=QuarryOut)
async def update_pickup_point(
    point_id: UUID,
    payload: QuarryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> dict:
    del current_user
    point = await _get_point_or_404(db, point_id)
    changed = payload.model_fields_set
    for field in (
        "name",
        "short_name",
        "point_type",
        "address",
        "description",
        "lat",
        "lon",
        "min_delivery_price",
        "is_active",
    ):
        if field in changed:
            setattr(point, field, getattr(payload, field))

    if "point_type" in changed and "min_delivery_price" not in changed:
        point.min_delivery_price = default_min_delivery_price(point.point_type)
    if "material_offers" in changed or "material_ids" in changed:
        await sync_material_offers(
            db,
            quarry_id=point.id,
            offers=payload.material_offers,
            legacy_material_ids=payload.material_ids,
        )
    if "delivery_option_ids" in changed:
        await sync_delivery_options(
            db,
            quarry_id=point.id,
            delivery_option_ids=payload.delivery_option_ids or [],
        )
    elif "point_type" in changed:
        await sync_delivery_options(
            db,
            quarry_id=point.id,
            delivery_option_ids=await default_delivery_option_ids(db, point.point_type),
        )
    await db.commit()
    await db.refresh(point)
    return await pickup_point_payload(db, point)


@router.put("/pickup-points/{point_id}/offers", response_model=QuarryOut)
async def replace_pickup_point_offers(
    point_id: UUID,
    offers: list[QuarryMaterialOfferIn],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> dict:
    del current_user
    point = await _get_point_or_404(db, point_id)
    await sync_material_offers(db, quarry_id=point.id, offers=offers)
    await db.commit()
    return await pickup_point_payload(db, point)


@router.put("/pickup-points/{point_id}/delivery-options", response_model=QuarryOut)
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
    await db.commit()
    return await pickup_point_payload(db, point)


@router.post("/pickup-points/{point_id}/approve", response_model=QuarryOut)
async def approve_pickup_point(
    point_id: UUID,
    payload: ModerationDecision,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> dict:
    point = await _get_point_or_404(db, point_id)
    await validate_point_can_be_approved(db, point)
    point.moderation_status = ModerationStatus.approved.value
    point.moderation_comment = payload.comment
    point.moderated_at = datetime.now(timezone.utc)
    point.moderated_by_user_id = current_user.id
    point.is_active = True
    await db.commit()
    return await pickup_point_payload(db, point)


@router.post("/pickup-points/{point_id}/reject", response_model=QuarryOut)
async def reject_pickup_point(
    point_id: UUID,
    payload: RejectionDecision,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> dict:
    point = await _get_point_or_404(db, point_id)
    point.moderation_status = ModerationStatus.rejected.value
    point.moderation_comment = payload.comment
    point.moderated_at = datetime.now(timezone.utc)
    point.moderated_by_user_id = current_user.id
    await db.commit()
    return await pickup_point_payload(db, point)


@router.post("/pickup-points/{point_id}/suspend", response_model=QuarryOut)
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
    await db.commit()
    return await pickup_point_payload(db, point)


@router.delete("/quarries/{point_id}", response_model=DeleteResult)
@router.delete("/pickup-points/{point_id}", response_model=DeleteResult)
async def hide_pickup_point(
    point_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
) -> DeleteResult:
    del current_admin
    point = await _get_point_or_404(db, point_id)
    point.is_active = False
    await db.commit()
    return DeleteResult(action="hidden", detail="Pickup point was hidden")
