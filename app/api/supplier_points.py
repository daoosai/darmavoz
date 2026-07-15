from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import ModerationStatus, Quarry, User
from app.schemas.quarry import QuarryCreate, QuarryMaterialOfferIn, QuarryOut, QuarryUpdate
from app.schemas.supplier import SupplierProfileOut, SupplierProfileUpdate
from app.security.auth import get_current_supplier_user
from app.services.notifications import schedule_pickup_point_moderation_notification
from app.services.pickup_points import (
    default_delivery_option_ids,
    default_min_delivery_price,
    pickup_point_payload,
    sync_delivery_options,
    sync_material_offers,
    validate_point_can_be_approved,
)

router = APIRouter()
SUPPLIER_POINT_TYPES = {"quarry", "accumulator", "warehouse", "supplier"}


async def _owned_point(db: AsyncSession, user: User, point_id: UUID) -> Quarry:
    point = await db.scalar(
        select(Quarry).where(Quarry.id == point_id, Quarry.owner_user_id == user.id)
    )
    if point is None:
        raise HTTPException(status_code=404, detail="Pickup point not found")
    return point


@router.get("/me", response_model=SupplierProfileOut)
async def get_supplier_profile(
    current_user: User = Depends(get_current_supplier_user),
) -> SupplierProfileOut:
    return SupplierProfileOut(
        phone=current_user.username,
        display_name=current_user.display_name,
    )


@router.patch("/me", response_model=SupplierProfileOut)
async def update_supplier_profile(
    payload: SupplierProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_supplier_user),
) -> SupplierProfileOut:
    current_user.display_name = payload.display_name
    await db.commit()
    await db.refresh(current_user)
    return SupplierProfileOut(
        phone=current_user.username,
        display_name=current_user.display_name,
    )


@router.get("/points", response_model=list[QuarryOut])
async def list_supplier_points(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_supplier_user),
) -> list[dict]:
    points = list(
        (
            await db.execute(
                select(Quarry)
                .where(Quarry.owner_user_id == current_user.id)
                .order_by(Quarry.created_at.desc())
            )
        ).scalars().all()
    )
    return [await pickup_point_payload(db, point) for point in points]


@router.post("/points", response_model=QuarryOut, status_code=status.HTTP_201_CREATED)
async def create_supplier_point(
    payload: QuarryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_supplier_user),
) -> dict:
    if payload.point_type not in SUPPLIER_POINT_TYPES:
        raise HTTPException(status_code=422, detail="Suppliers may create only quarry or accumulator points")
    point = Quarry(
        name=payload.name,
        short_name=payload.short_name,
        point_type=payload.point_type,
        address=payload.address,
        description=payload.description,
        lat=payload.lat,
        lon=payload.lon,
        min_delivery_price=default_min_delivery_price(payload.point_type),
        owner_user_id=current_user.id,
        moderation_status=ModerationStatus.incomplete.value,
        is_active=True,
    )
    db.add(point)
    await db.flush()
    await sync_material_offers(
        db, quarry_id=point.id, offers=payload.material_offers, legacy_material_ids=payload.material_ids
    )
    await sync_delivery_options(
        db,
        quarry_id=point.id,
        delivery_option_ids=await default_delivery_option_ids(db, point.point_type),
    )
    await db.commit()
    await db.refresh(point)
    return await pickup_point_payload(db, point)


@router.get("/points/{point_id}", response_model=QuarryOut)
async def get_supplier_point(
    point_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_supplier_user),
) -> dict:
    return await pickup_point_payload(db, await _owned_point(db, current_user, point_id))


@router.patch("/points/{point_id}", response_model=QuarryOut)
async def update_supplier_point(
    point_id: UUID,
    payload: QuarryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_supplier_user),
) -> dict:
    point = await _owned_point(db, current_user, point_id)
    if payload.point_type is not None and payload.point_type not in SUPPLIER_POINT_TYPES:
        raise HTTPException(status_code=422, detail="Suppliers may create only quarry or accumulator points")
    changed = payload.model_fields_set
    for field in ("name", "short_name", "point_type", "address", "description", "lat", "lon", "is_active"):
        if field in changed:
            setattr(point, field, getattr(payload, field))
    if "point_type" in changed:
        point.min_delivery_price = default_min_delivery_price(point.point_type)
        await sync_delivery_options(
            db,
            quarry_id=point.id,
            delivery_option_ids=await default_delivery_option_ids(db, point.point_type),
        )
    if "material_offers" in changed or "material_ids" in changed:
        await sync_material_offers(
            db,
            quarry_id=point.id,
            offers=payload.material_offers,
            legacy_material_ids=payload.material_ids,
        )
    if point.moderation_status == ModerationStatus.approved.value:
        point.moderation_status = ModerationStatus.pending_moderation.value
    await db.commit()
    return await pickup_point_payload(db, point)


@router.put("/points/{point_id}/offers", response_model=QuarryOut)
async def replace_supplier_offers(
    point_id: UUID,
    offers: list[QuarryMaterialOfferIn],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_supplier_user),
) -> dict:
    point = await _owned_point(db, current_user, point_id)
    await sync_material_offers(db, quarry_id=point.id, offers=offers)
    if point.moderation_status == ModerationStatus.approved.value:
        point.moderation_status = ModerationStatus.pending_moderation.value
    await db.commit()
    return await pickup_point_payload(db, point)


@router.post("/points/{point_id}/submit", response_model=QuarryOut)
async def submit_supplier_point(
    point_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_supplier_user),
) -> dict:
    point = await _owned_point(db, current_user, point_id)
    await validate_point_can_be_approved(db, point)
    point.moderation_status = ModerationStatus.pending_moderation.value
    point.moderation_comment = None
    await db.commit()
    schedule_pickup_point_moderation_notification(point)
    return await pickup_point_payload(db, point)
