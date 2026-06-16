from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ClientCreate(BaseModel):
    name: str
    phone: str


class ClientRegister(BaseModel):
    email: str
    phone: str
    name: str


class ClientSendCodeRequest(BaseModel):
    email: str


class ClientVerifyCodeRequest(BaseModel):
    email: str
    code: str


class ClientSendCodeResponse(BaseModel):
    ok: bool = True
    is_new_user: bool


class ClientAuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    client_id: UUID


class ClientResponse(BaseModel):
    id: UUID
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
