from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


ModerationAuditEntityType = Literal["quarry", "equipment"]


class ModerationAuditLogOut(BaseModel):
    id: UUID
    entity_type: ModerationAuditEntityType
    entity_id: UUID
    user_id: UUID | None = None
    action: str
    comment: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
