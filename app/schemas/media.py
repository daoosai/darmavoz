from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.catalog import MediaFileOut


class PresignUploadRequest(BaseModel):
    file_name: str
    content_type: str
    file_size: int = Field(gt=0)
    entity_type: str
    entity_id: UUID | None = None
    is_primary: bool = False
    sort_order: int = 0
    slot_key: str | None = None


class PresignUploadResponse(BaseModel):
    bucket: str
    object_key: str
    upload_url: str
    public_url: str
    expires_in: int


class ConfirmUploadRequest(BaseModel):
    entity_type: str
    entity_id: UUID
    object_key: str
    file_name: str
    content_type: str
    file_size: int = Field(gt=0)
    is_primary: bool = False
    sort_order: int = 0
    slot_key: str | None = None


class ConfirmUploadResponse(BaseModel):
    media_file: MediaFileOut

    model_config = ConfigDict(from_attributes=True)
