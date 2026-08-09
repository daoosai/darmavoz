from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import Quarry, Role, SepticProviderProfile, SpecialEquipmentListing, User, UserNotification, WaterPoint
from app.schemas.sprint19 import ConfirmationRequest, NotificationOut, SepticProfileIn, SepticProfileOut
from app.security.auth import get_current_equipment_owner_user, get_current_logist_user, get_current_user

router = APIRouter()
equipment_owner_router = APIRouter()


@router.get("/septic-providers", response_model=list[SepticProfileOut])
async def list_septic_providers(db: AsyncSession = Depends(get_db)):
    stmt = select(SepticProviderProfile).where(SepticProviderProfile.moderation_status == "approved", SepticProviderProfile.is_active.is_(True), SepticProviderProfile.is_deleted.is_(False))
    return (await db.execute(stmt.order_by(SepticProviderProfile.created_at.desc()))).scalars().all()


@equipment_owner_router.get("/septic-profile", response_model=SepticProfileOut)
async def get_septic_profile(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_equipment_owner_user)):
    profile = await db.scalar(select(SepticProviderProfile).where(SepticProviderProfile.owner_user_id == current_user.id, SepticProviderProfile.is_deleted.is_(False)))
    if profile is None: raise HTTPException(status_code=404, detail="Профиль септика не создан")
    return profile


@equipment_owner_router.put("/septic-profile", response_model=SepticProfileOut)
async def upsert_septic_profile(payload: SepticProfileIn, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_equipment_owner_user)):
    profile = await db.scalar(select(SepticProviderProfile).where(SepticProviderProfile.owner_user_id == current_user.id))
    if profile is None:
        profile = SepticProviderProfile(**payload.model_dump(), owner_user_id=current_user.id, moderation_status="pending_moderation")
        db.add(profile)
    else:
        for field, value in payload.model_dump().items(): setattr(profile, field, value)
        profile.is_deleted = False; profile.is_active = True; profile.moderation_status = "pending_moderation"; profile.moderation_comment = None
    await db.commit(); await db.refresh(profile); return profile


@equipment_owner_router.delete("/septic-profile")
async def delete_septic_profile(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_equipment_owner_user)):
    profile = await db.scalar(select(SepticProviderProfile).where(SepticProviderProfile.owner_user_id == current_user.id, SepticProviderProfile.is_deleted.is_(False)))
    if profile is None: raise HTTPException(status_code=404, detail="Профиль септика не найден")
    profile.is_deleted = True; profile.is_active = False; await db.commit(); return {"ok": True}


@router.post("/admin/septic-providers/{profile_id}/approve", response_model=SepticProfileOut)
async def approve_septic_provider(profile_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_logist_user)):
    profile = await db.get(SepticProviderProfile, profile_id)
    if profile is None or profile.is_deleted: raise HTTPException(status_code=404, detail="Профиль не найден")
    profile.moderation_status = "approved"; profile.moderated_by_user_id = current_user.id; profile.moderated_at = datetime.now(UTC)
    await db.commit(); await db.refresh(profile); return profile


@router.post("/admin/septic-providers/{profile_id}/reject", response_model=SepticProfileOut)
async def reject_septic_provider(profile_id: UUID, reason: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_logist_user)):
    profile = await db.get(SepticProviderProfile, profile_id)
    if profile is None or profile.is_deleted: raise HTTPException(status_code=404, detail="Профиль не найден")
    profile.moderation_status = "rejected"; profile.moderation_comment = reason; profile.moderated_by_user_id = current_user.id; profile.moderated_at = datetime.now(UTC)
    await db.commit(); await db.refresh(profile); return profile


@router.get("/notifications", response_model=list[NotificationOut])
async def list_notifications(unread_only: bool = False, limit: int = 50, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_logist_user)):
    stmt = select(UserNotification).where(UserNotification.user_id == current_user.id)
    if unread_only: stmt = stmt.where(UserNotification.is_read.is_(False))
    return (await db.execute(stmt.order_by(UserNotification.created_at.desc()).limit(min(max(limit, 1), 100)))).scalars().all()


@router.get("/notifications/unread-count")
async def unread_count(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_logist_user)):
    value = await db.scalar(select(func.count(UserNotification.id)).where(UserNotification.user_id == current_user.id, UserNotification.is_read.is_(False)))
    return {"count": value or 0}


@router.patch("/notifications/{notification_id}/read", response_model=NotificationOut)
async def read_notification(notification_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_logist_user)):
    item = await db.scalar(select(UserNotification).where(UserNotification.id == notification_id, UserNotification.user_id == current_user.id))
    if item is None: raise HTTPException(status_code=404, detail="Уведомление не найдено")
    if not item.is_read: item.is_read = True; item.read_at = datetime.now(UTC); await db.commit()
    return item


@router.post("/notifications/read-all")
async def read_all_notifications(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_logist_user)):
    rows = (await db.execute(select(UserNotification).where(UserNotification.user_id == current_user.id, UserNotification.is_read.is_(False)))).scalars().all()
    for row in rows: row.is_read = True; row.read_at = datetime.now(UTC)
    await db.commit(); return {"ok": True, "count": len(rows)}


@router.delete("/account/me")
async def delete_user_account(payload: ConfirmationRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not payload.confirm: raise HTTPException(status_code=422, detail="Подтвердите удаление аккаунта")
    role_name = current_user.role.name if current_user.role else ""
    if role_name == "admin":
        active_admins = await db.scalar(select(func.count(User.id)).join(Role).where(Role.name == "admin", User.is_active.is_(True), User.is_deleted.is_(False)))
        if (active_admins or 0) <= 1: raise HTTPException(status_code=409, detail="Нельзя удалить последнего активного администратора")
    for model in (Quarry, WaterPoint, SpecialEquipmentListing, SepticProviderProfile):
        rows = (await db.execute(select(model).where(model.owner_user_id == current_user.id))).scalars().all()
        for row in rows:
            row.is_active = False; row.is_deleted = True
            if hasattr(row, "contact_phone"): row.contact_phone = None
            if hasattr(row, "phone"): row.phone = "удалён"
    current_user.is_active = False; current_user.is_deleted = True; current_user.deleted_at = datetime.now(UTC); current_user.deletion_source = "self"; current_user.auth_version += 1
    current_user.username = f"deleted-{current_user.id}"[:50]; current_user.display_name = None; current_user.email = None; current_user.fcm_token = None
    await db.commit(); return {"ok": True}
