from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ClientCreate(BaseModel):
    name: str
    phone: str


class ClientResponse(BaseModel):
    id: UUID
    name: str
    phone: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)
