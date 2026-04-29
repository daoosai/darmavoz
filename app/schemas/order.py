from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class OrderDemoResponse(BaseModel):
    id: UUID
    status: str
    material: str | None
    volume: float | None
    address: str | None
    notes: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
