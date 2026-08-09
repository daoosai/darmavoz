import logging
from uuid import UUID
from pathlib import Path

from botocore.exceptions import ClientError
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import DeliveryOption, Driver, Material, MediaFile, ModerationStatus, Order, Quarry, SpecialEquipmentListing, User, Vehicle, WaterPoint
from app.schemas.media import (
    ConfirmUploadRequest,
    ConfirmUploadResponse,
    PresignUploadRequest,
    PresignUploadResponse,
)
from app.security.auth import get_current_user
from app.services.storage import (
    StorageNotConfiguredError,
    StorageValidationError,
    get_storage_service,
)
from app.services.vehicle_moderation import (
    REQUIRED_VEHICLE_MEDIA_SLOTS,
    set_incomplete_moderation,
)
from app.services.moderation import (
    EQUIPMENT_ENTITY_TYPE,
    QUARRY_ENTITY_TYPE,
    create_moderation_audit_log,
    mark_entity_pending_changes,
    schedule_admin_moderation_email,
)

router = APIRouter()
DRIVER_VEHICLE_MEDIA_SLOTS = REQUIRED_VEHICLE_MEDIA_SLOTS
logger = logging.getLogger("uvicorn.error")


def _get_entity_model(entity_type: str):
    model_map = {
        "material": Material,
        "delivery_option": DeliveryOption,
        "order": Order,
        "vehicle": Vehicle,
        "quarry": Quarry,
        "equipment_listing": SpecialEquipmentListing,
        "water_point": WaterPoint,
    }
    return model_map[entity_type]


async def _ensure_entity_exists(entity_type: str, entity_id: UUID, db: AsyncSession):
    model = _get_entity_model(entity_type)
    entity = await db.get(model, entity_id)
    if entity is None:
        raise HTTPException(status_code=404, detail=f"{entity_type} not found")
    return entity


async def _sync_entity_image_url(entity_type: str, entity_id: UUID, db: AsyncSession) -> None:
    if entity_type not in {"material", "delivery_option"}:
        return

    entity = await db.get(_get_entity_model(entity_type), entity_id)
    if entity is None:
        return

    result = await db.execute(
        select(MediaFile)
        .where(
            MediaFile.entity_type == entity_type,
            MediaFile.entity_id == entity_id,
        )
        .order_by(MediaFile.is_primary.desc(), MediaFile.sort_order.asc(), MediaFile.created_at.asc())
    )
    next_media = result.scalars().first()
    entity.image_url = next_media.public_url if next_media else None


async def _get_driver_profile(db: AsyncSession, user_id: UUID) -> Driver | None:
    result = await db.execute(select(Driver).where(Driver.user_id == user_id))
    return result.scalar_one_or_none()


async def _resolve_media_entity_context(
    *,
    db: AsyncSession,
    current_user: User,
    entity_type: str | None,
    entity_id: UUID | None,
    slot_key: str | None,
) -> tuple[str, UUID, Vehicle | None]:
    role_name = current_user.role.name if current_user.role else None
    if role_name in {"admin", "logist"}:
        if entity_type is None:
            raise HTTPException(status_code=400, detail="entity_type is required")
        if entity_id is None:
            raise HTTPException(status_code=400, detail="entity_id is required")
        if role_name == "logist" and entity_type != "equipment_listing":
            raise HTTPException(
                status_code=403,
                detail="Logists can manage media only for equipment listings",
            )
        entity = await _ensure_entity_exists(entity_type, entity_id, db)
        return entity_type, entity_id, entity if entity_type == "vehicle" else None

    if role_name == "equipment_owner":
        if entity_id is None or entity_type != "equipment_listing":
            raise HTTPException(
                status_code=403,
                detail="Equipment owners can upload media only for their own equipment listings",
            )
        listing = await db.get(SpecialEquipmentListing, entity_id)
        if listing is None or listing.owner_user_id != current_user.id:
            raise HTTPException(status_code=404, detail="Equipment listing not found")
        return "equipment_listing", entity_id, None

    if role_name == "supplier":
        if entity_id is None or entity_type not in {"quarry", "equipment_listing"}:
            raise HTTPException(
                status_code=403,
                detail="Suppliers can upload media only for their own entities",
            )
        if entity_type == "equipment_listing":
            listing = await db.get(SpecialEquipmentListing, entity_id)
            if listing is None or listing.owner_user_id != current_user.id:
                raise HTTPException(status_code=404, detail="Equipment listing not found")
            return "equipment_listing", entity_id, None
        point = await db.get(Quarry, entity_id)
        if point is None or point.owner_user_id != current_user.id:
            raise HTTPException(status_code=404, detail="Pickup point not found")
        return "quarry", entity_id, None

    if role_name != "driver":
        raise HTTPException(status_code=403, detail="Not enough permissions to manage media")

    driver = await _get_driver_profile(db, current_user.id)
    if driver is None:
        raise HTTPException(status_code=403, detail="Driver profile is not linked to the current user")
    if driver.vehicle_id is None:
        raise HTTPException(status_code=400, detail="Сначала сохраните данные автомобиля")
    if entity_type not in {None, "vehicle"}:
        raise HTTPException(status_code=403, detail="Drivers can upload media only for their vehicle")
    if entity_id is not None and entity_id != driver.vehicle_id:
        raise HTTPException(status_code=403, detail="Drivers can manage media only for their vehicle")
    if slot_key not in DRIVER_VEHICLE_MEDIA_SLOTS:
        raise HTTPException(status_code=400, detail="slot_key must be one of vehicle_main, vehicle_left, vehicle_plate")

    vehicle = await db.get(Vehicle, driver.vehicle_id)
    if vehicle is None:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return "vehicle", driver.vehicle_id, vehicle


async def _load_vehicle_media(db: AsyncSession, vehicle_id: UUID) -> list[MediaFile]:
    result = await db.execute(
        select(MediaFile)
        .where(MediaFile.entity_type == "vehicle", MediaFile.entity_id == vehicle_id)
        .order_by(MediaFile.created_at.asc())
    )
    return list(result.scalars().all())


async def _apply_supplier_media_moderation(
    db: AsyncSession,
    current_user: User,
    *,
    entity_type: str,
    entity_id: UUID,
    background_tasks: BackgroundTasks,
    action_label: str,
) -> None:
    role_name = current_user.role.name if current_user.role else None
    if role_name not in {"supplier", "equipment_owner"}:
        return
    entity = None
    entity_label = None
    entity_audit_type = None
    if entity_type == "equipment_listing":
        entity = await db.get(SpecialEquipmentListing, entity_id)
        entity_label = entity.title if entity is not None else None
        entity_audit_type = EQUIPMENT_ENTITY_TYPE
    elif entity_type == "quarry":
        entity = await db.get(Quarry, entity_id)
        entity_label = entity.name if entity is not None else None
        entity_audit_type = QUARRY_ENTITY_TYPE
    if entity is None or entity_audit_type is None:
        return

    if entity.moderation_status in {
        ModerationStatus.approved.value,
        ModerationStatus.has_pending_changes.value,
    }:
        mark_entity_pending_changes(entity, {"media_updated": True})
        schedule_admin_moderation_email(
            background_tasks,
            subject="Изменения фотографий ожидают модерации",
            body=(
                f'Пользователь изменил фотографии сущности "{entity_label or entity_id}". '
                f"Действие: {action_label}."
            ),
        )
    elif entity.moderation_status == ModerationStatus.rejected.value:
        entity.moderation_status = ModerationStatus.pending_moderation.value
        entity.moderation_comment = None
        entity.moderated_at = None
        entity.moderated_by_user_id = None

    await create_moderation_audit_log(
        db,
        entity_type=entity_audit_type,
        entity_id=entity_id,
        user_id=current_user.id,
        action="edited",
        comment=f"media:{action_label}",
    )


@router.post("/presign-upload", response_model=PresignUploadResponse)
async def presign_upload(
    payload: PresignUploadRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PresignUploadResponse:
    try:
        storage = get_storage_service()
        storage.assert_supported_image(payload.file_name, payload.content_type, payload.file_size)
    except StorageNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except StorageValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    entity_type, entity_id, _vehicle = await _resolve_media_entity_context(
        db=db,
        current_user=current_user,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        slot_key=payload.slot_key,
    )
    storage.assert_supported_entity_type(entity_type)

    if entity_id is not None:
        await _ensure_entity_exists(entity_type, entity_id, db)

    object_key = storage.build_object_key(entity_type, payload.file_name)
    upload_url = storage.generate_presigned_put(object_key, payload.content_type)
    logger.info("Generated upload URL: %s", upload_url)
    return PresignUploadResponse(
        bucket=storage.bucket,
        object_key=object_key,
        upload_url=upload_url,
        public_url=storage.build_public_url(object_key),
        expires_in=3600,
    )


@router.post("/confirm", response_model=ConfirmUploadResponse, status_code=status.HTTP_201_CREATED)
async def confirm_upload(
    payload: ConfirmUploadRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ConfirmUploadResponse:
    try:
        storage = get_storage_service()
    except StorageNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    entity_type, entity_id, vehicle = await _resolve_media_entity_context(
        db=db,
        current_user=current_user,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        slot_key=payload.slot_key,
    )
    storage.assert_supported_entity_type(entity_type)
    await _ensure_entity_exists(entity_type, entity_id, db)

    try:
        head_data = storage.head_object(payload.object_key)
    except ClientError as exc:
        raise HTTPException(status_code=404, detail="Uploaded object not found in storage") from exc

    file_name = payload.file_name or Path(payload.object_key).name
    content_type = payload.content_type or head_data.get("ContentType")
    file_size = payload.file_size or head_data.get("ContentLength")
    if not content_type or not file_size:
        raise HTTPException(status_code=400, detail="Unable to determine uploaded file metadata")

    try:
        storage.assert_supported_image(file_name, content_type, file_size)
    except StorageValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if payload.is_primary:
        await db.execute(
            update(MediaFile)
            .where(
                and_(
                    MediaFile.entity_type == entity_type,
                    MediaFile.entity_id == entity_id,
                    MediaFile.is_primary.is_(True),
                )
            )
            .values(is_primary=False)
        )

    result = await db.execute(select(MediaFile).where(MediaFile.object_key == payload.object_key))
    media_file = result.scalar_one_or_none()
    if media_file is None and payload.slot_key:
        result = await db.execute(
            select(MediaFile).where(
                MediaFile.entity_type == entity_type,
                MediaFile.entity_id == entity_id,
                MediaFile.slot_key == payload.slot_key,
            )
        )
        media_file = result.scalar_one_or_none()

    if media_file is None:
        media_file = MediaFile(
            entity_type=entity_type,
            entity_id=entity_id,
            bucket=storage.bucket,
            object_key=payload.object_key,
            public_url=storage.build_public_url(payload.object_key),
            content_type=content_type,
            file_name=file_name,
            file_size=file_size,
            sort_order=payload.sort_order,
            slot_key=payload.slot_key,
            is_primary=payload.is_primary,
        )
        db.add(media_file)
    else:
        media_file.entity_type = entity_type
        media_file.entity_id = entity_id
        media_file.bucket = storage.bucket
        media_file.public_url = storage.build_public_url(payload.object_key)
        media_file.content_type = content_type
        media_file.file_name = file_name
        media_file.file_size = file_size
        media_file.sort_order = payload.sort_order
        media_file.slot_key = payload.slot_key
        media_file.is_primary = payload.is_primary

    if vehicle is not None and (current_user.role.name if current_user.role else None) == "driver":
        linked_driver = await _get_driver_profile(db, current_user.id)
        if vehicle.moderation_status != ModerationStatus.suspended.value:
            set_incomplete_moderation(vehicle)
        if linked_driver is not None and linked_driver.moderation_status != ModerationStatus.suspended.value:
            set_incomplete_moderation(linked_driver)

    await _apply_supplier_media_moderation(
        db,
        current_user,
        entity_type=entity_type,
        entity_id=entity_id,
        background_tasks=background_tasks,
        action_label="upload",
    )
    await db.commit()
    await db.refresh(media_file)
    logger.info("Confirmed media %s, Public URL: %s", media_file.id, media_file.public_url)
    return ConfirmUploadResponse(media_file=media_file)


@router.delete("/{media_id}", status_code=status.HTTP_200_OK)
async def delete_media(
    media_id: UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, bool]:
    role_name = current_user.role.name if current_user.role else None
    if role_name not in {"admin", "logist", "supplier", "equipment_owner"}:
        raise HTTPException(status_code=403, detail="Media deletion is not allowed")

    result = await db.execute(select(MediaFile).where(MediaFile.id == media_id))
    media_file = result.scalar_one_or_none()
    if media_file is None:
        raise HTTPException(status_code=404, detail="Media file not found")
    await _resolve_media_entity_context(
        db=db,
        current_user=current_user,
        entity_type=media_file.entity_type,
        entity_id=media_file.entity_id,
        slot_key=media_file.slot_key,
    )

    try:
        storage = get_storage_service()
        try:
            storage.delete_object(media_file.object_key)
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code")
            if error_code not in {"NoSuchKey", "404"}:
                raise
    except StorageNotConfiguredError:
        storage = None

    entity_type = media_file.entity_type
    entity_id = media_file.entity_id
    await db.delete(media_file)
    await db.flush()
    await _sync_entity_image_url(entity_type, entity_id, db)
    await _apply_supplier_media_moderation(
        db,
        current_user,
        entity_type=entity_type,
        entity_id=entity_id,
        background_tasks=background_tasks,
        action_label="delete",
    )
    await db.commit()
    return {"ok": True}


@router.post("/{media_id}/make-primary", status_code=status.HTTP_200_OK)
async def make_media_primary(
    media_id: UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, bool]:
    result = await db.execute(select(MediaFile).where(MediaFile.id == media_id))
    media_file = result.scalar_one_or_none()
    if media_file is None:
        raise HTTPException(status_code=404, detail="Media file not found")

    await _resolve_media_entity_context(
        db=db,
        current_user=current_user,
        entity_type=media_file.entity_type,
        entity_id=media_file.entity_id,
        slot_key=media_file.slot_key,
    )

    await db.execute(
        update(MediaFile)
        .where(
            and_(
                MediaFile.entity_type == media_file.entity_type,
                MediaFile.entity_id == media_file.entity_id,
            )
        )
        .values(is_primary=False)
    )
    media_file.is_primary = True
    await _sync_entity_image_url(media_file.entity_type, media_file.entity_id, db)
    await _apply_supplier_media_moderation(
        db,
        current_user,
        entity_type=media_file.entity_type,
        entity_id=media_file.entity_id,
        background_tasks=background_tasks,
        action_label="make_primary",
    )
    await db.commit()
    return {"ok": True}
