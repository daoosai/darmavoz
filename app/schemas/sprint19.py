from datetime import datetime
from typing import Literal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class PasswordResetRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)


class PasswordResetVerify(PasswordResetRequest):
    code: str = Field(min_length=4, max_length=8)


class PasswordResetVerifyResponse(BaseModel):
    reset_token: str
    role: Literal["admin", "logist"]
    name: str | None
    email: str | None


class PasswordResetComplete(BaseModel):
    reset_token: str = Field(min_length=20, max_length=512)
    new_password: str = Field(min_length=8, max_length=128)


class WaterPointIn(BaseModel):
    water_type: Literal["free", "paid"]
    name: str | None = Field(default=None, max_length=255)
    source: str = Field(min_length=1, max_length=255)
    address: str = Field(min_length=1, max_length=2000)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    phone: str | None = Field(default=None, max_length=20)
    price: float | None = Field(default=None, gt=0)
    price_unit: str | None = Field(default=None, max_length=50)
    description: str | None = Field(default=None, max_length=5000)

    @model_validator(mode="after")
    def validate_type(self):
        if self.water_type == "paid":
            if not self.name or not self.name.strip():
                raise ValueError("Для платной воды обязательно название")
            if not self.phone or not self.phone.strip():
                raise ValueError("Для платной воды обязательно заполните телефон")
            if self.price is None:
                raise ValueError("Для платной воды обязательно укажите цену")
            if not self.price_unit or not self.price_unit.strip():
                raise ValueError("Для платной воды обязательно укажите единицу измерения")
        if self.water_type == "free" and (self.price is not None or self.price_unit is not None):
            raise ValueError("Для бесплатной воды цена не указывается")
        return self


class WaterPointOut(WaterPointIn):
    id: UUID
    owner_user_id: UUID | None = None
    moderation_status: str
    moderation_comment: str | None = None
    is_active: bool
    created_at: datetime | None = None
    primary_image_url: str | None = None

    model_config = {"from_attributes": True}


class SepticProfileIn(BaseModel):
    phone: str = Field(min_length=5, max_length=20)
    address: str = Field(min_length=1, max_length=2000)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    tank_volume_m3: float = Field(gt=0)
    service_price: float = Field(gt=0)


class SepticMediaOut(BaseModel):
    id: UUID
    public_url: str
    file_name: str
    is_primary: bool
    sort_order: int | None = None

    model_config = {"from_attributes": True}


class SepticProfileOut(SepticProfileIn):
    id: UUID
    owner_user_id: UUID | None = None
    moderation_status: str
    moderation_comment: str | None = None
    is_active: bool
    primary_image_url: str | None = None
    media_files: list[SepticMediaOut] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class NotificationOut(BaseModel):
    id: UUID
    event_type: str
    title: str
    body: str
    payload: dict
    is_read: bool
    read_at: datetime | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class ClientCancelOrderRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class ClientClarificationReplyRequest(BaseModel):
    reply: str = Field(min_length=1, max_length=2000)


class ConfirmationRequest(BaseModel):
    confirm: bool
