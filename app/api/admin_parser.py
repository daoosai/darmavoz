from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import CrmStatus, PointAuditLog, Quarry, Role, User, WaterPoint
from app.schemas.parser import CrmPointOut, CrmUpdateRequest, ParserRunRequest, ParserRunResult, PointAuditLogOut, PointKind, PointOwnerBindingRequest
from app.security.auth import get_current_admin_user
from app.services.twogis_places import search_places, upsert_places


router = APIRouter()


def _model_for_kind(point_kind: PointKind):
    return Quarry if point_kind == "quarry" else WaterPoint


async def _get_point_or_404(db: AsyncSession, point_kind: PointKind, point_id: UUID):
    point = await db.get(_model_for_kind(point_kind), point_id)
    if point is None or (point_kind == "water" and point.is_deleted):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Point not found")
    return point


def _serialize_crm_point(point, point_kind: PointKind) -> CrmPointOut:
    return CrmPointOut(id=point.id, point_kind=point_kind, owner_user_id=point.owner_user_id, crm_status=point.crm_status, crm_comment=point.crm_comment)


async def _add_status_audit_log(db: AsyncSession, *, point, point_kind: PointKind, admin_id: UUID, old_status: str | None, new_status: str) -> None:
    if old_status != new_status:
        db.add(PointAuditLog(point_id=point.id, point_kind=point_kind, admin_id=admin_id, old_status=old_status, new_status=new_status))


@router.post("/parser/run", response_model=ParserRunResult)
async def run_parser(payload: ParserRunRequest, db: AsyncSession = Depends(get_db), current_admin: User = Depends(get_current_admin_user)) -> ParserRunResult:
    places, truncated = await search_places(payload)
    try:
        result = await upsert_places(db, payload=payload, places=places, admin_id=current_admin.id, truncated=truncated)
        await db.commit()
        return result
    except SQLAlchemyError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Unable to save imported 2GIS places") from exc


@router.patch("/crm/{point_kind}/{point_id}", response_model=CrmPointOut)
async def update_point_crm(point_kind: PointKind, point_id: UUID, payload: CrmUpdateRequest, db: AsyncSession = Depends(get_db), current_admin: User = Depends(get_current_admin_user)) -> CrmPointOut:
    point = await _get_point_or_404(db, point_kind, point_id)
    if payload.crm_status == CrmStatus.active.value and point.owner_user_id is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="An owner must be linked before CRM activation")
    if point_kind == "water" and payload.crm_status == CrmStatus.active.value and point.water_type == "unknown":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Select a water type before CRM activation")
    old_status = point.crm_status
    point.crm_status = payload.crm_status
    point.crm_comment = payload.crm_comment
    if payload.crm_status == CrmStatus.active.value:
        point.is_active = True
    await _add_status_audit_log(db, point=point, point_kind=point_kind, admin_id=current_admin.id, old_status=old_status, new_status=payload.crm_status)
    await db.commit()
    await db.refresh(point)
    return _serialize_crm_point(point, point_kind)


@router.post("/crm/{point_kind}/{point_id}/owner", response_model=CrmPointOut)
async def bind_point_owner(point_kind: PointKind, point_id: UUID, payload: PointOwnerBindingRequest, db: AsyncSession = Depends(get_db), current_admin: User = Depends(get_current_admin_user)) -> CrmPointOut:
    point = await _get_point_or_404(db, point_kind, point_id)
    required_role = "supplier" if point_kind == "quarry" else "water_septic_partner"
    owner = await db.scalar(select(User).join(Role).where(User.id == payload.owner_user_id, User.is_active.is_(True), User.is_deleted.is_(False), Role.name == required_role))
    if owner is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Selected owner is unavailable or has an incompatible role")
    if point_kind == "water" and point.water_type == "unknown":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Select a water type before linking an active owner")
    old_status = point.crm_status
    point.owner_user_id = owner.id
    point.crm_status = CrmStatus.active.value
    point.is_active = True
    await _add_status_audit_log(db, point=point, point_kind=point_kind, admin_id=current_admin.id, old_status=old_status, new_status=CrmStatus.active.value)
    await db.commit()
    await db.refresh(point)
    return _serialize_crm_point(point, point_kind)


@router.get("/crm/{point_kind}/{point_id}/audit-log", response_model=list[PointAuditLogOut])
async def get_point_audit_log(point_kind: PointKind, point_id: UUID, db: AsyncSession = Depends(get_db), current_admin: User = Depends(get_current_admin_user)) -> list[PointAuditLog]:
    del current_admin
    await _get_point_or_404(db, point_kind, point_id)
    result = await db.execute(select(PointAuditLog).where(PointAuditLog.point_kind == point_kind, PointAuditLog.point_id == point_id).order_by(PointAuditLog.created_at.desc()))
    return list(result.scalars().all())
