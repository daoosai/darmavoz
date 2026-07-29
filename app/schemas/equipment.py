from datetime import date, datetime, time
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.catalog import MediaFileOut


TariffType = Literal["hour", "shift"]
ApplicationStatus = Literal["new", "in_progress", "closed", "completed", "rejected", "cancelled"]
DurationUnit = Literal["hours", "shifts"]
ModerationStatusValue = Literal[
    "incomplete", "pending_moderation", "approved", "rejected", "suspended"
]


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


class EquipmentTariff(BaseModel):
    type: TariffType
    price: float | None = Field(default=None, gt=0)
    hours: float | None = Field(default=None, gt=0, le=24)


def _coerce_positive_number(value: object, *, max_value: float | None = None) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number <= 0:
        return None
    if max_value is not None and number > max_value:
        return None
    return number


def _sanitize_tariffs_for_output(value: object) -> list[dict]:
    if not isinstance(value, list):
        return []

    sanitized: list[dict] = []
    for item in value:
        if not isinstance(item, dict):
            continue

        tariff_type = item.get("type")
        if tariff_type not in ("hour", "shift"):
            continue

        price = _coerce_positive_number(item.get("price"))
        if tariff_type == "hour":
            sanitized.append({"type": "hour", "price": price, "hours": None})
            continue

        hours = _coerce_positive_number(item.get("hours"), max_value=24)
        if hours is None:
            continue
        sanitized.append({"type": "shift", "price": price, "hours": hours})

    return sanitized


def _normalize_tariffs(tariffs: list[EquipmentTariff]) -> list[EquipmentTariff]:
    if not tariffs:
        raise ValueError("Укажите хотя бы один тариф")
    tariff_types = [tariff.type for tariff in tariffs]
    if tariff_types.count("hour") != 1:
        raise ValueError("Должен быть указан один базовый тариф «За час»")
    if len(set(tariff_types)) != len(tariff_types):
        raise ValueError("Тарифы не должны повторяться")
    hour_tariff = next(tariff for tariff in tariffs if tariff.type == "hour")
    if hour_tariff.price is None:
        raise ValueError("Укажите цену за час")
    hour_tariff.hours = None
    for tariff in tariffs:
        if tariff.type == "shift":
            if tariff.hours is None:
                raise ValueError("Укажите количество часов в смене")
            tariff.price = round(hour_tariff.price * tariff.hours, 2)
    return tariffs


class EquipmentListingBase(BaseModel):
    equipment_type: str | None = Field(default=None, min_length=1, max_length=255)
    equipment_type_id: UUID | None = None
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(min_length=1, max_length=10000)
    contact_phone: str | None = Field(default=None, max_length=20)
    tariffs: list[EquipmentTariff] = Field(min_length=1, max_length=2)
    city: str | None = Field(default=None, max_length=255)
    district: str | None = Field(default=None, max_length=255)
    is_active: bool = True
    is_vip: bool = False
    manual_priority: int = 0
    sort_order: int = 0

    model_config = ConfigDict(str_strip_whitespace=True)

    @model_validator(mode="after")
    def validate_tariffs(self):
        if self.equipment_type is None and self.equipment_type_id is None:
            raise ValueError("equipment_type or equipment_type_id is required")
        self.tariffs = _normalize_tariffs(self.tariffs)
        return self


class EquipmentListingCreate(EquipmentListingBase):
    pass


class EquipmentListingUpdate(BaseModel):
    equipment_type: str | None = Field(default=None, min_length=1, max_length=255)
    equipment_type_id: UUID | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, min_length=1, max_length=10000)
    contact_phone: str | None = Field(default=None, max_length=20)
    tariffs: list[EquipmentTariff] | None = Field(default=None, min_length=1, max_length=2)
    city: str | None = Field(default=None, max_length=255)
    district: str | None = Field(default=None, max_length=255)
    is_active: bool | None = None
    is_vip: bool | None = None
    manual_priority: int | None = None
    sort_order: int | None = None

    model_config = ConfigDict(str_strip_whitespace=True)

    @model_validator(mode="after")
    def validate_tariffs(self):
        if self.tariffs is not None:
            self.tariffs = _normalize_tariffs(self.tariffs)
        return self


class EquipmentListingOut(BaseModel):
    id: UUID
    equipment_type: str
    equipment_type_id: UUID | None = None
    equipment_type_name: str
    title: str
    description: str
    contact_phone: str | None = None
    tariffs: list[EquipmentTariff]
    city: str | None
    district: str | None
    is_active: bool
    is_vip: bool = False
    manual_priority: int = 0
    price_from: float | None = None
    sort_order: int
    media_files: list[MediaFileOut] = Field(default_factory=list)
    primary_image_url: str | None = None
    owner_user_id: UUID | None = None
    moderation_status: ModerationStatusValue
    moderation_comment: str | None = None
    created_at: datetime
    updated_at: datetime

    @field_validator("tariffs", mode="before")
    @classmethod
    def validate_output_tariffs(cls, value: object) -> list[dict]:
        return _sanitize_tariffs_for_output(value)


class OperatorEquipmentListingOut(EquipmentListingOut):
    owner_name: str | None = None
    owner_phone: str | None = None


class EquipmentModerationDecision(BaseModel):
    comment: str | None = Field(default=None, max_length=5000)

    model_config = ConfigDict(str_strip_whitespace=True)


class EquipmentModerationRejection(BaseModel):
    reason: str = Field(min_length=1, max_length=5000)

    model_config = ConfigDict(str_strip_whitespace=True)


class EquipmentApplicationCreate(BaseModel):
    listing_id: UUID
    object_address: str = Field(min_length=3, max_length=1000)
    requested_date: date
    requested_time: time
    duration_value: float = Field(gt=0, le=1000)
    duration_unit: DurationUnit
    total_price: float | None = Field(default=None, ge=0)
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


class EquipmentApplicationReject(BaseModel):
    reject_reason: str = Field(min_length=1, max_length=5000)

    model_config = ConfigDict(str_strip_whitespace=True)


class EquipmentApplicationCancel(BaseModel):
    cancel_reason: str = Field(min_length=1, max_length=5000)

    model_config = ConfigDict(str_strip_whitespace=True)


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
    total_price: float | None
    comment: str | None
    reject_reason: str | None
    cancel_reason: str | None
    status: ApplicationStatus
    processed_by_user_id: UUID | None
    primary_image_url: str | None = None
    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None
