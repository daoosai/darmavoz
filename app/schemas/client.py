from uuid import UUID

from pydantic import BaseModel


class ClientCreate(BaseModel):
    name: str
    phone: str


class ClientResponse(BaseModel):
    id: UUID
    name: str
    phone: str

    class Config:
        from_attributes = True
