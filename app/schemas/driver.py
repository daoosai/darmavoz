from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class DriverCreate(BaseModel):
    name: str
    phone: str
    status: Optional[str] = None


class DriverResponse(BaseModel):
    id: UUID
    name: str
    phone: str
    status: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)
