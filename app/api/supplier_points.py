import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import ModerationStatus, Quarry, User
from app.schemas.client import ClientFcmTokenIn, ClientFcmTokenOut
from app.schemas.quarry import QuarryCreate, QuarryMaterialOfferIn, QuarryOut, QuarryUpdate
from app.schemas.supplier import SupplierProfileOut, SupplierProfileUpdate
from app.security.auth import get_current_supplier_user
from app.services.fcm_tokens import detach_fcm_token_from_other_entities
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
logger = logging.getLogger(__name__)
SUPPLIER_POINT_TYPES = {"quarry", "accumulator"}
SUPPLIER_EDIT_REMODERATION_STATUSES = {
    ModerationStatus.rejected.value,
    ModerationStatus.approved.value,
}


def _extract_material_offers(payload: QuarryCreate | QuarryUpdate | dict):
    if isinstance(payload, dict):
        if "material_offers" in payload:
            return payload.get("material_offers")
        return payload.get("materials")
    if payload.material_offers is not None:
        return payload.material_offers
    return payload.materials


def _validate_supplier_display_name(user: User) -> None:
    if (user.display_name or "").strip():
        return
    raise HTTPException(status_code=400, detail="Заполните ФИО в профиле")


def _supplier_phone_value(user: User) -> str | None:
    return user.username if "@" not in (user.username or "") else None


def _reset_point_moderation_after_supplier_edit(point: Quarry) -> None:
    if point.moderation_status in SUPPLIER_EDIT_REMODERATION_STATUSES:
        point.moderation_status = ModerationStatus.pending_moderation.value
        point.moderation_comment = None


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
        phone=_supplier_phone_value(current_user),
        email=current_user.email,
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
        phone=_supplier_phone_value(current_user),
        email=current_user.email,
        display_name=current_user.display_name,
    )


@router.post("/me/fcm-token", response_model=ClientFcmTokenOut)
async def save_supplier_fcm_token(
    payload: ClientFcmTokenIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_supplier_user),
) -> ClientFcmTokenOut:
    normalized_token = payload.token.strip()
    logger.info(
        "supplier_fcm_token_save_requested",
        extra={
            "user_id": str(current_user.id),
            "token_prefix": normalized_token[:24],
        },
    )
    await detach_fcm_token_from_other_entities(
        db,
        normalized_token,
        keep_user_id=current_user.id,
    )
    current_user.fcm_token = normalized_token
    await db.commit()
    return ClientFcmTokenOut(ok=True, token=current_user.fcm_token)


@router.delete("/me/fcm-token", response_model=ClientFcmTokenOut)
async def delete_supplier_fcm_token(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_supplier_user),
) -> ClientFcmTokenOut:
    logger.info(
        "supplier_fcm_token_deleted",
        extra={"user_id": str(current_user.id)},
    )
    current_user.fcm_token = None
    await db.commit()
    return ClientFcmTokenOut(ok=True, token=None)


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
    _validate_supplier_display_name(current_user)
    if payload.point_type not in SUPPLIER_POINT_TYPES:
        raise HTTPException(status_code=422, detail="Suppliers may create only quarry or accumulator points")
    short_name = payload.short_name or payload.name
    point = Quarry(
        name=payload.name,
        short_name=short_name,
        point_type=payload.point_type,
        address=payload.address,
        description=payload.description,
        contact_phone=_supplier_phone_value(current_user),
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
        db,
        quarry_id=point.id,
        offers=_extract_material_offers(payload),
        legacy_material_ids=payload.material_ids,
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
    payload_data = payload.model_dump(exclude_unset=True)
    if "name" in payload_data and "short_name" not in payload_data:
        payload_data["short_name"] = payload_data["name"]
    elif "short_name" in payload_data and not payload_data["short_name"]:
        payload_data["short_name"] = payload_data.get("name") or point.name
    changed = set(payload_data)
    for field in ("name", "short_name", "point_type", "address", "description", "lat", "lon", "is_active"):
        if field in changed:
            setattr(point, field, payload_data[field])
    if "point_type" in changed:
        point.min_delivery_price = default_min_delivery_price(point.point_type)
        await sync_delivery_options(
            db,
            quarry_id=point.id,
            delivery_option_ids=await default_delivery_option_ids(db, point.point_type),
        )
    if "material_offers" in changed or "materials" in changed or "material_ids" in changed:
        await sync_material_offers(
            db,
            quarry_id=point.id,
            offers=_extract_material_offers(payload_data),
            legacy_material_ids=payload_data.get("material_ids"),
        )
    _reset_point_moderation_after_supplier_edit(point)
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
    _reset_point_moderation_after_supplier_edit(point)
    await db.commit()
    return await pickup_point_payload(db, point)


@router.post("/points/{point_id}/submit", response_model=QuarryOut)
async def submit_supplier_point(
    point_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_supplier_user),
) -> dict:
    point = await _owned_point(db, current_user, point_id)
    await validate_point_can_be_approved(
        db,
        point,
        require_materials=True,
        require_coordinates=False,
    )
    point.moderation_status = ModerationStatus.pending_moderation.value
    point.moderation_comment = None
    await db.commit()
    await db.refresh(point)
    try:
        schedule_pickup_point_moderation_notification(point)
    except Exception as exc:
        logger.error(
            "pickup_point_moderation_notification_failed",
            extra={"pickup_point_id": str(point.id)},
            exc_info=exc,
        )
    return await pickup_point_payload(db, point)
