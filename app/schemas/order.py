from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class OrderItemOut(BaseModel):
    id: UUID
    material_id: UUID
    volume: float
    price: float | None
    amount: float | None

    model_config = ConfigDict(from_attributes=True)


class OrderDemoResponse(BaseModel):
    id: UUID
    status: str
    total_amount: float = 0.0
    items: list[OrderItemOut] = []
    address: str | None
    notes: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
