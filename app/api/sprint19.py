from datetime import UTC, datetime
from uuid import UUID

from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import Client, MediaFile, Quarry, Role, SepticProviderProfile, SpecialEquipmentListing, User, UserNotification, WaterPoint
from app.schemas.sprint19 import ConfirmationRequest, NotificationOut, SepticMediaOut, SepticProfileIn, SepticProfileOut
from app.security.auth import get_current_client, get_current_equipment_owner_user, get_current_logist_user, get_current_user, oauth2_scheme
from app.services.notifications import create_operator_notifications
from app.services.storage import StorageNotConfiguredError, get_storage_service

router = APIRouter()
equipment_owner_router = APIRouter()


async def _serialize_septic_profile(
    profile: SepticProviderProfile,
    db: AsyncSession,
) -> SepticProfileOut:
    media_files = list(
        (
            await db.execute(
                select(MediaFile)
                .where(
                    MediaFile.entity_type == "septic_profile",
                    MediaFile.entity_id == profile.id,
                )
                .order_by(
                    MediaFile.is_primary.desc(),
                    MediaFile.sort_order.asc(),
                    MediaFile.created_at.asc(),
                )
            )
        )
        .scalars()
        .all()
    )
    return SepticProfileOut.model_validate(profile).model_copy(
        update={
            "primary_image_url": media_files[0].public_url if media_files else None,
            "media_files": [SepticMediaOut.model_validate(media_file) for media_file in media_files],
        }
    )


async def _serialize_septic_profiles(
    profiles: list[SepticProviderProfile],
    db: AsyncSession,
) -> list[SepticProfileOut]:
    return [await _serialize_septic_profile(profile, db) for profile in profiles]


async def _hard_delete_septic_profile(
    profile: SepticProviderProfile,
    db: AsyncSession,
) -> None:
    media_files = list(
        (
            await db.execute(
                select(MediaFile).where(
                    MediaFile.entity_type == "septic_profile",
                    MediaFile.entity_id == profile.id,
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
                    raise
        await db.delete(media_file)

    await db.delete(profile)


@router.get("/septic-providers", response_model=list[SepticProfileOut])
async def list_septic_providers(db: AsyncSession = Depends(get_db)):
    stmt = select(SepticProviderProfile).where(SepticProviderProfile.moderation_status == "approved", SepticProviderProfile.is_active.is_(True), SepticProviderProfile.is_deleted.is_(False))
    profiles = (await db.execute(stmt.order_by(SepticProviderProfile.created_at.desc()))).scalars().all()
    return await _serialize_septic_profiles(list(profiles), db)


@router.get("/admin/septic-providers", response_model=list[SepticProfileOut])
async def list_septic_providers_for_moderation(
    moderation_status: str | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    del current_user
    stmt = select(SepticProviderProfile).where(SepticProviderProfile.is_deleted.is_(False))
    selected_status = moderation_status or status
    if selected_status and selected_status.lower() not in {"all", "все"}:
        stmt = stmt.where(SepticProviderProfile.moderation_status == selected_status)
    profiles = (await db.execute(stmt.order_by(SepticProviderProfile.created_at.desc()))).scalars().all()
    return await _serialize_septic_profiles(list(profiles), db)


@equipment_owner_router.get("/septic-profiles", response_model=list[SepticProfileOut])
async def list_my_septic_profiles(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_equipment_owner_user),
):
    profiles = (
        await db.execute(
            select(SepticProviderProfile)
            .where(
                SepticProviderProfile.owner_user_id == current_user.id,
                SepticProviderProfile.is_deleted.is_(False),
            )
            .order_by(SepticProviderProfile.created_at.desc())
        )
    ).scalars().all()
    return await _serialize_septic_profiles(list(profiles), db)


@equipment_owner_router.post("/septic-profiles", response_model=SepticProfileOut, status_code=201)
async def create_septic_profile(
    payload: SepticProfileIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_equipment_owner_user),
):
    profile = SepticProviderProfile(
        **payload.model_dump(),
        owner_user_id=current_user.id,
        moderation_status="pending_moderation",
    )
    db.add(profile)
    await db.flush()
    await create_operator_notifications(
        db,
        event_type="septic_profile_created",
        title="Новая заявка на откачку септика",
        body=f'Поставщик отправил на модерацию септик по адресу «{profile.address}».',
        payload={"septic_profile_id": str(profile.id), "event": "septic_profile_created"},
    )
    await db.commit()
    await db.refresh(profile)
    return await _serialize_septic_profile(profile, db)


@equipment_owner_router.patch("/septic-profiles/{profile_id}", response_model=SepticProfileOut)
async def update_septic_profile(
    profile_id: UUID,
    payload: SepticProfileIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_equipment_owner_user),
):
    profile = await db.scalar(
        select(SepticProviderProfile).where(
            SepticProviderProfile.id == profile_id,
            SepticProviderProfile.owner_user_id == current_user.id,
            SepticProviderProfile.is_deleted.is_(False),
        )
    )
    if profile is None:
        raise HTTPException(status_code=404, detail="Профиль септика не найден")

    for field, value in payload.model_dump().items():
        setattr(profile, field, value)
    profile.moderation_status = "pending_moderation"
    profile.moderation_comment = None
    profile.is_active = True
    await db.flush()
    await create_operator_notifications(
        db,
        event_type="septic_profile_updated",
        title="Заявка на откачку септика изменена",
        body=f'Поставщик отправил изменения септика по адресу «{profile.address}» на модерацию.',
        payload={"septic_profile_id": str(profile.id), "event": "septic_profile_updated"},
    )
    await db.commit()
    await db.refresh(profile)
    return await _serialize_septic_profile(profile, db)


@equipment_owner_router.delete("/septic-profile/{profile_id}/hard")
async def hard_delete_septic_profile(
    profile_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_equipment_owner_user),
):
    profile = await db.scalar(
        select(SepticProviderProfile).where(
            SepticProviderProfile.id == profile_id,
            SepticProviderProfile.owner_user_id == current_user.id,
        )
    )
    if profile is None:
        raise HTTPException(status_code=404, detail="Профиль септика не найден")

    await _hard_delete_septic_profile(profile, db)
    await db.commit()
    return {"ok": True}


@equipment_owner_router.get("/septic-profile", response_model=SepticProfileOut)
async def get_septic_profile(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_equipment_owner_user)):
    profile = await db.scalar(
        select(SepticProviderProfile)
        .where(SepticProviderProfile.owner_user_id == current_user.id, SepticProviderProfile.is_deleted.is_(False))
        .order_by(SepticProviderProfile.created_at.desc())
    )
    if profile is None: raise HTTPException(status_code=404, detail="Профиль септика не создан")
    return await _serialize_septic_profile(profile, db)


@equipment_owner_router.put("/septic-profile", response_model=SepticProfileOut)
async def upsert_septic_profile(payload: SepticProfileIn, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_equipment_owner_user)):
    profile = await db.scalar(select(SepticProviderProfile).where(SepticProviderProfile.owner_user_id == current_user.id))
    if profile is None:
        profile = SepticProviderProfile(**payload.model_dump(), owner_user_id=current_user.id, moderation_status="pending_moderation")
        db.add(profile)
    else:
        for field, value in payload.model_dump().items(): setattr(profile, field, value)
        profile.is_deleted = False; profile.is_active = True; profile.moderation_status = "pending_moderation"; profile.moderation_comment = None
    await db.commit(); await db.refresh(profile); return await _serialize_septic_profile(profile, db)


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
    await db.commit(); await db.refresh(profile); return await _serialize_septic_profile(profile, db)


@router.post("/admin/septic-providers/{profile_id}/reject", response_model=SepticProfileOut)
async def reject_septic_provider(profile_id: UUID, reason: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_logist_user)):
    profile = await db.get(SepticProviderProfile, profile_id)
    if profile is None or profile.is_deleted: raise HTTPException(status_code=404, detail="Профиль не найден")
    profile.moderation_status = "rejected"; profile.moderation_comment = reason; profile.moderated_by_user_id = current_user.id; profile.moderated_at = datetime.now(UTC)
    await db.commit(); await db.refresh(profile); return await _serialize_septic_profile(profile, db)


@router.patch("/admin/septic-providers/{profile_id}", response_model=SepticProfileOut)
async def update_septic_provider_by_admin(
    profile_id: UUID,
    payload: SepticProfileIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    profile = await db.get(SepticProviderProfile, profile_id)
    if profile is None or profile.is_deleted:
        raise HTTPException(status_code=404, detail="Профиль септика не найден")

    for field, value in payload.model_dump().items():
        setattr(profile, field, value)
    await db.commit()
    await db.refresh(profile)
    return await _serialize_septic_profile(profile, db)


@router.post("/admin/septic-providers/{profile_id}/suspend", response_model=SepticProfileOut)
async def suspend_septic_provider(
    profile_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    profile = await db.get(SepticProviderProfile, profile_id)
    if profile is None or profile.is_deleted:
        raise HTTPException(status_code=404, detail="Профиль септика не найден")

    profile.moderation_status = "suspended"
    profile.is_active = False
    profile.moderated_by_user_id = current_user.id
    profile.moderated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(profile)
    return await _serialize_septic_profile(profile, db)


@router.post("/admin/septic-providers/{profile_id}/restore", response_model=SepticProfileOut)
async def restore_septic_provider(
    profile_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    profile = await db.get(SepticProviderProfile, profile_id)
    if profile is None or profile.is_deleted:
        raise HTTPException(status_code=404, detail="Профиль септика не найден")
    if profile.moderation_status not in {"suspended", "archived"}:
        raise HTTPException(status_code=409, detail="Профиль септика не находится в архиве")

    profile.moderation_status = "approved"
    profile.is_active = True
    profile.moderated_by_user_id = current_user.id
    profile.moderated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(profile)
    return await _serialize_septic_profile(profile, db)


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
async def delete_user_account(
    payload: ConfirmationRequest,
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
):
    if not payload.confirm:
        raise HTTPException(status_code=422, detail="Подтвердите удаление аккаунта")

    try:
        current_user = await get_current_user(token=token, db=db)
    except HTTPException:
        current_client: Client = await get_current_client(token=token, db=db)
        current_client.is_deleted = True
        current_client.deleted_at = datetime.now(UTC)
        current_client.deletion_source = "self"
        current_client.auth_version += 1
        current_client.name = "Удалённый пользователь"
        current_client.email = None
        current_client.phone = None
        current_client.external_source = None
        current_client.external_user_id = None
        current_client.fcm_token = None
        await db.commit()
        return {"ok": True}

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
