from app.services.cities import initialize_service_cities
from datetime import UTC, datetime
import logging
from uuid import UUID

from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.cities import resolve_city, ensure_owner_city
from app.services.cities import resolve_city, ensure_same_city
from app.db.database import get_db
from app.models.models import CrmStatus, MediaFile, User, WaterPoint
from app.schemas.sprint19 import WaterPointAdminUpdate, WaterPointIn, WaterPointOut
from app.schemas.bulk import BulkDeleteRequest, BulkDeleteResult
from app.security.auth import get_current_logist_user, get_current_water_septic_partner_user
from app.services.notifications import create_operator_notifications
from app.services.storage import StorageNotConfiguredError, get_storage_service

router = APIRouter()
water_septic_partner_router = APIRouter()
logger = logging.getLogger(__name__)


def _is_water_point_ready(point: WaterPoint) -> bool:
    # The admin activation toggle is authoritative for the client map.  A point
    # can be managed directly and therefore must not require an owner or price
    # before it is shown as available.
    return point.is_active


def _public_stmt():
    return select(WaterPoint).where(
        WaterPoint.crm_status == CrmStatus.activated.value,
        WaterPoint.moderation_status == "approved",
        WaterPoint.is_active.is_(True),
        WaterPoint.is_deleted.is_(False),
    )


async def _serialize_point(point: WaterPoint, db: AsyncSession) -> WaterPointOut:
    """Return the point together with its primary photo stored in S3/MinIO."""
    primary_image_url = await db.scalar(
        select(MediaFile.public_url)
        .where(
            MediaFile.entity_type == "water_point",
            MediaFile.entity_id == point.id,
        )
        .order_by(
            MediaFile.is_primary.desc(),
            MediaFile.sort_order.asc(),
            MediaFile.created_at.asc(),
        )
        .limit(1)
    )
    return WaterPointOut.model_validate(point).model_copy(
        update={
            "primary_image_url": primary_image_url,
            "is_ready": _is_water_point_ready(point),
        }
    )


async def _serialize_points(points: list[WaterPoint], db: AsyncSession) -> list[WaterPointOut]:
    return [await _serialize_point(point, db) for point in points]


async def _hard_delete_water_point(point: WaterPoint, db: AsyncSession) -> None:
    """Physically remove a water point and all media records attached to it."""
    media_files = list(
        (
            await db.execute(
                select(MediaFile).where(
                    MediaFile.entity_type == "water_point",
                    MediaFile.entity_id == point.id,
                )
            )
        )
        .scalars()
        .all()
    )

    try:
        storage = get_storage_service()
    except StorageNotConfiguredError:
        storage = None

    for media_file in media_files:
        if storage is not None:
            try:
                storage.delete_object(media_file.object_key)
            except ClientError as exc:
                error_code = exc.response.get("Error", {}).get("Code")
                if error_code not in {"NoSuchKey", "404"}:
                    logger.warning("Could not remove water point media object %s", media_file.object_key)
            except Exception:
                logger.exception("Could not remove water point media object %s", media_file.object_key)
        await db.delete(media_file)

    await db.delete(point)


@router.get("/water-points", response_model=list[WaterPointOut])
async def list_water_points(water_type: str | None = None, city_id: UUID | None = None, db: AsyncSession = Depends(get_db)):
    selected_city = await resolve_city(db, city_id)
    stmt = _public_stmt().where(WaterPoint.city_id == selected_city.id)
    if water_type in {"free", "paid"}:
        stmt = stmt.where(WaterPoint.water_type == water_type)
    points = (await db.execute(stmt.order_by(WaterPoint.created_at.desc()))).scalars().all()
    return await _serialize_points(list(points), db)


@router.get("/water-points/map", response_model=list[WaterPointOut])
async def list_water_points_for_map(
    response: Response,
    water_type: str | None = None,
    city_id: UUID | None = None, db: AsyncSession = Depends(get_db),
):
    selected_city = await resolve_city(db, city_id)
    response.headers["Cache-Control"] = "no-store, max-age=0"
    stmt = select(WaterPoint).where(WaterPoint.city_id == selected_city.id).where(
        WaterPoint.is_deleted.is_(False),
        WaterPoint.crm_status.in_(
            [
                CrmStatus.invite_sent.value,
                CrmStatus.activated.value,
            ]
        ),
    )
    if water_type in {"free", "paid", "unknown"}:
        stmt = stmt.where(WaterPoint.water_type == water_type)
    points = (await db.execute(stmt.order_by(WaterPoint.created_at.desc()))).scalars().all()
    return await _serialize_points(list(points), db)


@router.get("/admin/water-points", response_model=list[WaterPointOut])
async def list_water_points_for_moderation(
    moderation_status: str | None = None,
    status: str | None = None,
    crm_status: CrmStatus | None = None,
    city_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    city_filter = (WaterPoint.city_id == city_id) if city_id is not None else True
    # Parser-created points have no owner. Keep the owner relation optional so
    # moderation and CRM filters do not hide those points.
    stmt = (
        select(WaterPoint)
        .outerjoin(User, WaterPoint.owner_user_id == User.id)
        .where(city_filter)
        .where(WaterPoint.is_deleted.is_(False))
    )
    selected_status = moderation_status or status
    if selected_status and selected_status.lower() not in {"all", "все"}:
        stmt = stmt.where(WaterPoint.moderation_status == selected_status)
    if crm_status is not None:
        stmt = stmt.where(WaterPoint.crm_status == crm_status.value)
    points = (await db.execute(stmt.order_by(WaterPoint.created_at.desc()))).scalars().all()
    return await _serialize_points(list(points), db)


@router.post("/admin/water-points", response_model=WaterPointOut, status_code=status.HTTP_201_CREATED)
async def create_water_point_by_admin(
    payload: WaterPointIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    selected_city = await resolve_city(db, payload.city_id, require_active=False)
    await ensure_owner_city(db, None, selected_city.id)
    await initialize_service_cities(db, user_id=current_user.id, city_ids=[selected_city.id], require_active=False)
    payload.city_id = selected_city.id
    point = WaterPoint(
        **payload.model_dump(),
        owner_user_id=current_user.id,
        moderation_status="approved",
        moderated_at=datetime.now(UTC),
        moderated_by_user_id=current_user.id,
    )
    db.add(point)
    await db.commit()
    await db.refresh(point)
    return await _serialize_point(point, db)


@router.get("/water-points/{point_id}", response_model=WaterPointOut)
async def get_water_point(point_id: UUID, city_id: UUID | None = None, db: AsyncSession = Depends(get_db)):
    selected_city = await resolve_city(db, city_id)
    point = await db.scalar(_public_stmt().where(WaterPoint.city_id == selected_city.id).where(WaterPoint.id == point_id))
    if point is None: raise HTTPException(status_code=404, detail="Точка воды не найдена")
    return await _serialize_point(point, db)


@water_septic_partner_router.get("/water-points", response_model=list[WaterPointOut])
async def my_water_points(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_water_septic_partner_user)):
    points = (await db.execute(select(WaterPoint).where(WaterPoint.owner_user_id == current_user.id, WaterPoint.is_deleted.is_(False)).order_by(WaterPoint.created_at.desc()))).scalars().all()
    return await _serialize_points(list(points), db)


@water_septic_partner_router.post("/water-points", response_model=WaterPointOut, status_code=status.HTTP_201_CREATED)
async def create_water_point(payload: WaterPointIn, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_water_septic_partner_user)):
    selected_city = await resolve_city(db, payload.city_id, require_active=False)
    await ensure_owner_city(db, current_user.id, selected_city.id)
    payload.city_id = selected_city.id
    point = WaterPoint(**payload.model_dump(), owner_user_id=current_user.id, moderation_status="pending_moderation")
    db.add(point)
    await db.flush()
    await create_operator_notifications(
        db,
        event_type="water_point_created",
        title="Новая точка воды на модерации",
        body=f'Поставщик отправил точку воды "{point.name or point.source}" на модерацию.',
        payload={"water_point_id": str(point.id), "event": "water_point_created"},
    )
    await db.commit()
    await db.refresh(point)
    return await _serialize_point(point, db)


@water_septic_partner_router.patch("/water-points/{point_id}", response_model=WaterPointOut)
async def update_water_point(point_id: UUID, payload: WaterPointIn, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_water_septic_partner_user)):
    selected_city = await resolve_city(db, payload.city_id, require_active=False)
    await ensure_owner_city(db, current_user.id, selected_city.id)
    payload.city_id = selected_city.id
    point = await db.scalar(select(WaterPoint).where(WaterPoint.id == point_id, WaterPoint.owner_user_id == current_user.id, WaterPoint.is_deleted.is_(False)))
    if point is None: raise HTTPException(status_code=404, detail="Точка воды не найдена")
    for field, value in payload.model_dump().items(): setattr(point, field, value)
    point.moderation_status = "pending_moderation"; point.moderation_comment = None
    await db.flush()
    await create_operator_notifications(
        db,
        event_type="water_point_updated",
        title="Точка воды изменена",
        body=f'Поставщик отправил правки точки воды "{point.name or point.source}" на модерацию.',
        payload={"water_point_id": str(point.id), "event": "water_point_updated"},
    )
    await db.commit()
    await db.refresh(point)
    return await _serialize_point(point, db)


@water_septic_partner_router.delete("/water-points/{point_id}")
async def delete_water_point(point_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_water_septic_partner_user)):
    point = await db.scalar(select(WaterPoint).where(WaterPoint.id == point_id, WaterPoint.owner_user_id == current_user.id))
    if point is None: raise HTTPException(status_code=404, detail="Точка воды не найдена")
    point.is_deleted = True; point.is_active = False; await db.commit(); return {"ok": True}


@router.patch("/admin/water-points/{point_id}", response_model=WaterPointOut)
async def update_water_point_by_admin(
    point_id: UUID,
    payload: WaterPointAdminUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    point = await db.get(WaterPoint, point_id)
    if point is None or point.is_deleted:
        raise HTTPException(status_code=404, detail="Точка воды не найдена")

    selected_city = await resolve_city(db, payload.city_id if "city_id" in payload.model_fields_set else point.city_id, require_active=False)
    await ensure_owner_city(
        db,
        point.owner_user_id,
        selected_city.id,
        auto_sync=current_user.role is not None and current_user.role.name == "admin",
    )
    payload.city_id = selected_city.id

    payload_data = payload.model_dump(exclude_unset=True)
    for field, value in payload_data.items():
        setattr(point, field, value)
    if "moderation_status" in payload_data:
        point.moderated_at = datetime.now(UTC)
        point.moderated_by_user_id = current_user.id
    await db.commit()
    await db.refresh(point)
    return await _serialize_point(point, db)


@water_septic_partner_router.delete("/water-points/{point_id}/hard")
async def hard_delete_water_point(
    point_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_water_septic_partner_user),
):
    point = await db.scalar(
        select(WaterPoint).where(
            WaterPoint.id == point_id,
            WaterPoint.owner_user_id == current_user.id,
        )
    )
    if point is None:
        raise HTTPException(status_code=404, detail="Точка воды не найдена")

    await _hard_delete_water_point(point, db)
    await db.commit()
    return {"ok": True}


@router.delete("/admin/water-points/{point_id}")
@router.delete("/admin/water-points/{point_id}/hard")
async def hard_delete_water_point_by_admin(
    point_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    point = await db.get(WaterPoint, point_id)
    if point is None:
        raise HTTPException(status_code=404, detail="Точка воды не найдена")

    await _hard_delete_water_point(point, db)
    await db.commit()
    return {"ok": True}


@router.post("/admin/water-points/bulk-delete", response_model=BulkDeleteResult)
async def bulk_delete_water_points(
    payload: BulkDeleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> BulkDeleteResult:
    del current_user
    points = (await db.execute(select(WaterPoint).where(WaterPoint.id.in_(set(payload.point_ids))))).scalars().all()
    for point in points:
        await _hard_delete_water_point(point, db)
    await db.commit()
    return BulkDeleteResult(deleted_count=len(points))


@router.post("/admin/water-points/{point_id}/approve", response_model=WaterPointOut)
async def approve_water_point(point_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_logist_user)):
    point = await db.get(WaterPoint, point_id)
    if point is None or point.is_deleted: raise HTTPException(status_code=404, detail="Точка воды не найдена")
    point.moderation_status = "approved"; point.moderated_at = datetime.now(UTC); point.moderated_by_user_id = current_user.id
    await db.commit(); await db.refresh(point); return await _serialize_point(point, db)


@router.post("/admin/water-points/{point_id}/reject", response_model=WaterPointOut)
async def reject_water_point(point_id: UUID, reason: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_logist_user)):
    point = await db.get(WaterPoint, point_id)
    if point is None or point.is_deleted: raise HTTPException(status_code=404, detail="Точка воды не найдена")
    point.moderation_status = "rejected"; point.moderation_comment = reason; point.moderated_at = datetime.now(UTC); point.moderated_by_user_id = current_user.id
    await db.commit(); await db.refresh(point); return await _serialize_point(point, db)


@router.post("/admin/water-points/{point_id}/suspend", response_model=WaterPointOut)
async def suspend_water_point(point_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_logist_user)):
    point = await db.get(WaterPoint, point_id)
    if point is None or point.is_deleted: raise HTTPException(status_code=404, detail="Точка воды не найдена")
    point.moderation_status = "suspended"; point.is_active = False; point.moderated_at = datetime.now(UTC); point.moderated_by_user_id = current_user.id
    await db.commit(); await db.refresh(point); return await _serialize_point(point, db)


@router.post("/admin/water-points/{point_id}/restore", response_model=WaterPointOut)
async def restore_water_point(point_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_logist_user)):
    point = await db.get(WaterPoint, point_id)
    if point is None or point.is_deleted:
        raise HTTPException(status_code=404, detail="Точка воды не найдена")
    if point.moderation_status not in {"suspended", "archived"}:
        raise HTTPException(status_code=409, detail="Точка воды не находится в архиве")

    point.moderation_status = "approved"
    point.is_active = True
    point.moderated_at = datetime.now(UTC)
    point.moderated_by_user_id = current_user.id
    await db.commit()
    await db.refresh(point)
    return await _serialize_point(point, db)
