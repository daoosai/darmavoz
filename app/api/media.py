from uuid import UUID

from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import DeliveryOption, Material, MediaFile, Order, User, Vehicle
from app.schemas.media import (
    ConfirmUploadRequest,
    ConfirmUploadResponse,
    PresignUploadRequest,
    PresignUploadResponse,
)
from app.security.auth import get_current_admin_user
from app.services.storage import (
    StorageNotConfiguredError,
    StorageValidationError,
    get_storage_service,
)

router = APIRouter()


def _get_entity_model(entity_type: str):
    model_map = {
        "material": Material,
        "delivery_option": DeliveryOption,
        "order": Order,
        "vehicle": Vehicle,
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


@router.post("/presign-upload", response_model=PresignUploadResponse)
async def presign_upload(
    payload: PresignUploadRequest,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
) -> PresignUploadResponse:
    del current_admin
    try:
        storage = get_storage_service()
        storage.assert_supported_entity_type(payload.entity_type)
        storage.assert_supported_image(payload.file_name, payload.content_type, payload.file_size)
    except StorageNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except StorageValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if payload.entity_id is not None:
        await _ensure_entity_exists(payload.entity_type, payload.entity_id, db)

    object_key = storage.build_object_key(payload.entity_type, payload.file_name)
    upload_url = storage.generate_presigned_put(object_key, payload.content_type)
    return PresignUploadResponse(
        bucket=storage.bucket,
        object_key=object_key,
        upload_url=upload_url,
        public_url=storage.build_public_url(object_key),
        expires_in=900,
    )


@router.post("/confirm", response_model=ConfirmUploadResponse, status_code=status.HTTP_201_CREATED)
async def confirm_upload(
    payload: ConfirmUploadRequest,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
) -> ConfirmUploadResponse:
    del current_admin
    try:
        storage = get_storage_service()
        storage.assert_supported_entity_type(payload.entity_type)
        storage.assert_supported_image(payload.file_name, payload.content_type, payload.file_size)
    except StorageNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except StorageValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    await _ensure_entity_exists(payload.entity_type, payload.entity_id, db)

    try:
        storage.head_object(payload.object_key)
    except ClientError as exc:
        raise HTTPException(status_code=404, detail="Uploaded object not found in storage") from exc

    if payload.is_primary:
        await db.execute(
            update(MediaFile)
            .where(
                and_(
                    MediaFile.entity_type == payload.entity_type,
                    MediaFile.entity_id == payload.entity_id,
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
                MediaFile.entity_type == payload.entity_type,
                MediaFile.entity_id == payload.entity_id,
                MediaFile.slot_key == payload.slot_key,
            )
        )
        media_file = result.scalar_one_or_none()

    if media_file is None:
        media_file = MediaFile(
            entity_type=payload.entity_type,
            entity_id=payload.entity_id,
            bucket=storage.bucket,
            object_key=payload.object_key,
            public_url=storage.build_public_url(payload.object_key),
            content_type=payload.content_type,
            file_name=payload.file_name,
            file_size=payload.file_size,
            sort_order=payload.sort_order,
            slot_key=payload.slot_key,
            is_primary=payload.is_primary,
        )
        db.add(media_file)
    else:
        media_file.entity_type = payload.entity_type
        media_file.entity_id = payload.entity_id
        media_file.bucket = storage.bucket
        media_file.public_url = storage.build_public_url(payload.object_key)
        media_file.content_type = payload.content_type
        media_file.file_name = payload.file_name
        media_file.file_size = payload.file_size
        media_file.sort_order = payload.sort_order
        media_file.slot_key = payload.slot_key
        media_file.is_primary = payload.is_primary

    await db.commit()
    await db.refresh(media_file)
    return ConfirmUploadResponse(media_file=media_file)


@router.delete("/{media_id}", status_code=status.HTTP_200_OK)
async def delete_media(
    media_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
) -> dict[str, bool]:
    del current_admin
    result = await db.execute(select(MediaFile).where(MediaFile.id == media_id))
    media_file = result.scalar_one_or_none()
    if media_file is None:
        raise HTTPException(status_code=404, detail="Media file not found")

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
    await db.commit()
    return {"ok": True}


@router.post("/{media_id}/make-primary", status_code=status.HTTP_200_OK)
async def make_media_primary(
    media_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
) -> dict[str, bool]:
    del current_admin
    result = await db.execute(select(MediaFile).where(MediaFile.id == media_id))
    media_file = result.scalar_one_or_none()
    if media_file is None:
        raise HTTPException(status_code=404, detail="Media file not found")

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
    await db.commit()
    return {"ok": True}
