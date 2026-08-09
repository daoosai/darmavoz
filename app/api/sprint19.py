from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import SepticProviderProfile, User, UserNotification
from app.schemas.sprint19 import NotificationOut, SepticProfileIn, SepticProfileOut
from app.security.auth import get_current_equipment_owner_user, get_current_logist_user

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
