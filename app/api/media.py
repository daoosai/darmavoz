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


async def _ensure_entity_exists(entity_type: str, entity_id: UUID, db: AsyncSession) -> None:
    model_map = {
        "material": Material,
        "delivery_option": DeliveryOption,
        "order": Order,
        "vehicle": Vehicle,
    }
    model = model_map[entity_type]
    entity = await db.get(model, entity_id)
    if entity is None:
        raise HTTPException(status_code=404, detail=f"{entity_type} not found")


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
