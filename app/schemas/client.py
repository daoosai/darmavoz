from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator


class ClientCreate(BaseModel):
    name: str
    phone: str


class ClientRegister(BaseModel):
    name: str
    phone_number: str = Field(validation_alias=AliasChoices("phone_number", "phone"))
    email: str | None = None

    model_config = ConfigDict(populate_by_name=True)


class ClientSendCodeRequest(BaseModel):
    phone_number: str = Field(validation_alias=AliasChoices("phone_number", "phone"))

    model_config = ConfigDict(populate_by_name=True)


class ClientVerifyCodeRequest(BaseModel):
    phone_number: str = Field(validation_alias=AliasChoices("phone_number", "phone"))
    code: str

    model_config = ConfigDict(populate_by_name=True)


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


class ClientProfileResponse(BaseModel):
    id: UUID
    first_name: str
    last_name: str | None = None
    name: str
    phone: str | None = None
    created_at: datetime | None = None


class ClientProfileUpdate(BaseModel):
    first_name: str | None = Field(default=None, max_length=255)
    last_name: str | None = Field(default=None, max_length=255)

    @field_validator("first_name", "last_name", mode="before")
    @classmethod
    def normalize_name_part(cls, value):
        if value is None:
            return None
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return str(value).strip() or None


class ClientFcmTokenIn(BaseModel):
    token: str = Field(min_length=1, max_length=1024)

    @field_validator("token")
    @classmethod
    def validate_token(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Token must not be empty")
        return normalized


class ClientFcmTokenOut(BaseModel):
    ok: bool
    token: str | None = None


class ClientAddressBase(BaseModel):
    full_address: str = Field(min_length=1, max_length=500)
    comment: str | None = None
    lat: float | None = None
    lon: float | None = None

    @field_validator("comment", mode="before")
    @classmethod
    def normalize_comment(cls, value):
        if value is None:
            return None
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return str(value)

    @field_validator("lat", "lon", mode="before")
    @classmethod
    def normalize_optional_float(cls, value):
        if value is None:
            return None
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return None
        return value


class ClientAddressCreate(ClientAddressBase):
    is_default: bool | None = None


class ClientAddressUpdate(ClientAddressBase):
    pass


class ClientAddressOut(BaseModel):
    id: UUID
    client_id: UUID
    full_address: str
    comment: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    is_default: bool
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
