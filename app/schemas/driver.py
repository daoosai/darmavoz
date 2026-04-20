from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class DriverCreate(BaseModel):
    name: str
    phone: str
    status: Optional[str] = None


class DriverResponse(BaseModel):
    id: UUID
    name: str
    phone: str
    status: Optional[str] = None

    class Config:
        from_attributes = True
