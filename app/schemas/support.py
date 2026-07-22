from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.services.storage import normalize_public_url


SupportStatus = Literal["new", "in_progress", "closed"]
SupportContextType = Literal[
    "general", "order", "pickup_point", "equipment_listing", "user"
]


class SupportTicketCreate(BaseModel):
    subject: str = Field(min_length=1, max_length=255)
    category: str = Field(default="general", min_length=1, max_length=50)
    context_type: SupportContextType = "general"
    context_id: UUID | None = None
    message: str = Field(min_length=1, max_length=10000)
    attachment_url: str | None = Field(default=None, max_length=2048)

    model_config = ConfigDict(str_strip_whitespace=True)

    @model_validator(mode="after")
    def validate_context(self):
        if self.context_type == "general":
            self.context_id = None
        elif self.context_id is None:
            raise ValueError("context_id is required for the selected context")
        return self


class SupportMessageCreate(BaseModel):
    text: str | None = Field(default=None, max_length=10000)
    attachment_url: str | None = Field(default=None, max_length=2048)

    model_config = ConfigDict(str_strip_whitespace=True)

    @model_validator(mode="after")
    def validate_message_content(self):
        if self.text or self.attachment_url:
            return self
        raise ValueError("text or attachment_url is required")


class SupportMessageUpdate(BaseModel):
    text: str = Field(min_length=1, max_length=10000)

    model_config = ConfigDict(str_strip_whitespace=True)


class SupportAttachmentPresignRequest(BaseModel):
    file_name: str
    content_type: str
    file_size: int = Field(gt=0)


class SupportAttachmentPresignResponse(BaseModel):
    bucket: str
    object_key: str
    upload_url: str
    public_url: str
    expires_in: int


class SupportAttachmentConfirmRequest(BaseModel):
    object_key: str
    file_name: str | None = None
    content_type: str | None = None
    file_size: int | None = Field(default=None, gt=0)


class SupportAttachmentConfirmResponse(BaseModel):
    public_url: str

    @field_validator("public_url")
    @classmethod
    def normalize_attachment_public_url(cls, value: str) -> str:
        normalized = normalize_public_url(value)
        return normalized or value


class SupportStatusUpdate(BaseModel):
    status: SupportStatus


class SupportMessageOut(BaseModel):
    id: UUID
    ticket_id: UUID
    sender_id: UUID | None = None
    author_client_id: UUID | None
    author_user_id: UUID | None
    author_name: str
    author_role: str
    text: str
    attachment_url: str | None = None
    is_read: bool = False
    is_own: bool = False
    created_at: datetime

    @field_validator("attachment_url")
    @classmethod
    def normalize_attachment_url(cls, value: str | None) -> str | None:
        return normalize_public_url(value)


class SupportTicketOut(BaseModel):
    id: UUID
    subject: str
    category: str
    context_type: SupportContextType
    context_id: UUID | None
    status: SupportStatus
    requester_name: str
    requester_phone: str | None
    requester_role: str
    assigned_to_user_id: UUID | None
    messages: list[SupportMessageOut] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None

    model_config = ConfigDict(from_attributes=True)
