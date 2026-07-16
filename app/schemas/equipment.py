from datetime import date, datetime, time
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.catalog import MediaFileOut


PriceUnit = Literal["hour", "shift", "day", "negotiable"]
ApplicationStatus = Literal["new", "in_progress", "closed", "rejected"]
DurationUnit = Literal["hours", "shifts"]


class EquipmentTypeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    is_active: bool = True
    sort_order: int = 0

    model_config = ConfigDict(str_strip_whitespace=True)


class EquipmentTypeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    is_active: bool | None = None
    sort_order: int | None = None

    model_config = ConfigDict(str_strip_whitespace=True)


class EquipmentTypeOut(BaseModel):
    id: UUID
    name: str
    slug: str
    is_active: bool
    sort_order: int

    model_config = ConfigDict(from_attributes=True)


class EquipmentListingBase(BaseModel):
    equipment_type_id: UUID
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(min_length=1, max_length=10000)
    price_amount: float | None = Field(default=None, gt=0)
    price_unit: PriceUnit
    city: str | None = Field(default=None, max_length=255)
    district: str | None = Field(default=None, max_length=255)
    is_active: bool = True
    sort_order: int = 0

    model_config = ConfigDict(str_strip_whitespace=True)

    @model_validator(mode="after")
    def validate_price(self):
        if self.price_unit == "negotiable":
            self.price_amount = None
        elif self.price_amount is None:
            raise ValueError("price_amount is required for a fixed price")
        return self


class EquipmentListingCreate(EquipmentListingBase):
    pass


class EquipmentListingUpdate(BaseModel):
    equipment_type_id: UUID | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, min_length=1, max_length=10000)
    price_amount: float | None = Field(default=None, gt=0)
    price_unit: PriceUnit | None = None
    city: str | None = Field(default=None, max_length=255)
    district: str | None = Field(default=None, max_length=255)
    is_active: bool | None = None
    sort_order: int | None = None

    model_config = ConfigDict(str_strip_whitespace=True)


class EquipmentListingOut(BaseModel):
    id: UUID
    equipment_type_id: UUID
    equipment_type_name: str
    title: str
    description: str
    price_amount: float | None
    price_unit: PriceUnit
    city: str | None
    district: str | None
    is_active: bool
    sort_order: int
    media_files: list[MediaFileOut] = Field(default_factory=list)
    primary_image_url: str | None = None
    created_at: datetime
    updated_at: datetime


class EquipmentApplicationCreate(BaseModel):
    listing_id: UUID
    object_address: str = Field(min_length=3, max_length=1000)
    requested_date: date
    requested_time: time
    duration_value: float = Field(gt=0, le=1000)
    duration_unit: DurationUnit
    comment: str | None = Field(default=None, max_length=5000)
    contact_phone: str = Field(min_length=10, max_length=20)

    model_config = ConfigDict(str_strip_whitespace=True)


class EquipmentApplicationStatusUpdate(BaseModel):
    status: ApplicationStatus
    reject_reason: str | None = Field(default=None, min_length=1, max_length=5000)

    model_config = ConfigDict(str_strip_whitespace=True)

    @model_validator(mode="after")
    def validate_reject_reason(self):
        if self.status == "rejected" and not self.reject_reason:
            raise ValueError("reject_reason is required for rejected applications")
        return self


class EquipmentApplicationOut(BaseModel):
    id: UUID
    listing_id: UUID
    client_id: UUID
    listing_title_snapshot: str
    contact_phone: str
    client_name: str | None = None
    object_address: str
    requested_date: date
    requested_time: time
    duration_value: float
    duration_unit: DurationUnit
    comment: str | None
    reject_reason: str | None
    status: ApplicationStatus
    processed_by_user_id: UUID | None
    primary_image_url: str | None = None
    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None
