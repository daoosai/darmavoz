from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


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

    model_config = ConfigDict(str_strip_whitespace=True)

    @model_validator(mode="after")
    def validate_context(self):
        if self.context_type == "general":
            self.context_id = None
        elif self.context_id is None:
            raise ValueError("context_id is required for the selected context")
        return self


class SupportMessageCreate(BaseModel):
    text: str = Field(min_length=1, max_length=10000)

    model_config = ConfigDict(str_strip_whitespace=True)


class SupportStatusUpdate(BaseModel):
    status: SupportStatus


class SupportMessageOut(BaseModel):
    id: UUID
    ticket_id: UUID
    author_client_id: UUID | None
    author_user_id: UUID | None
    author_name: str
    author_role: str
    text: str
    created_at: datetime


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
