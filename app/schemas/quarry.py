from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.catalog import DeliveryOptionOut, MediaFileOut


PickupPointTypeValue = Literal["quarry", "accumulator", "warehouse", "supplier"]
ModerationStatusValue = Literal[
    "incomplete", "pending_moderation", "approved", "rejected", "suspended"
]


def _normalize_optional_text(value: object) -> object:
    if value is None:
        return None
    if isinstance(value, str):
        normalized = value.strip()
        return normalized or None
    return value


def _normalize_optional_coordinate_value(value: object) -> object:
    normalized = _normalize_optional_text(value)
    if normalized is None:
        return None
    return normalized


def _normalize_subscription_end_date_value(value: object) -> object:
    normalized = _normalize_optional_text(value)
    if normalized is None or not isinstance(normalized, str):
        return normalized

    if len(normalized) == 10 and normalized[4] == "-" and normalized[7] == "-":
        year, month, day = normalized.split("-")
        return datetime(int(year), int(month), int(day), tzinfo=timezone.utc)

    if len(normalized) == 10 and normalized[2] == "." and normalized[5] == ".":
        day, month, year = normalized.split(".")
        return datetime(int(year), int(month), int(day), tzinfo=timezone.utc)

    try:
        return datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    except ValueError:
        pass

    return normalized


class QuarryMaterialRef(BaseModel):
    id: UUID
    name: str
    unit: str
    price: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)


class QuarryMaterialOfferIn(BaseModel):
    material_id: UUID
    price: float = Field(gt=0)
    is_active: bool = True


class QuarryMaterialOfferOut(BaseModel):
    material_id: UUID
    price: Optional[float] = None
    is_active: bool = True
    material_name: str
    unit: str


class QuarryBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    short_name: Optional[str] = Field(default=None, max_length=100)
    point_type: PickupPointTypeValue = "quarry"
    address: str = Field(default="", max_length=1000)
    description: Optional[str] = Field(default=None, max_length=5000)
    contact_phone: Optional[str] = Field(default=None, max_length=20)
    subscription_end_date: Optional[datetime] = None
    lat: Optional[float] = None
    lon: Optional[float] = None

    model_config = ConfigDict(str_strip_whitespace=True)

    @field_validator("contact_phone", mode="before")
    @classmethod
    def normalize_contact_phone(cls, value: Optional[str]) -> Optional[str]:
        return _normalize_optional_text(value)

    @field_validator("short_name", mode="before")
    @classmethod
    def normalize_short_name(cls, value: Optional[str]) -> Optional[str]:
        return _normalize_optional_text(value)

    @field_validator("description", mode="before")
    @classmethod
    def normalize_description(cls, value: Optional[str]) -> Optional[str]:
        return _normalize_optional_text(value)

    @field_validator("subscription_end_date", mode="before")
    @classmethod
    def normalize_subscription_end_date(cls, value: object) -> object:
        return _normalize_subscription_end_date_value(value)

    @field_validator("lat", mode="before")
    @classmethod
    def validate_lat(cls, value: object) -> Optional[float]:
        value = _normalize_optional_coordinate_value(value)
        if value is None:
            return None
        if value is not None and (value < -90 or value > 90):
            raise ValueError("Latitude must be between -90 and 90")
        return value

    @field_validator("lon", mode="before")
    @classmethod
    def validate_lon(cls, value: object) -> Optional[float]:
        value = _normalize_optional_coordinate_value(value)
        if value is None:
            return None
        if value is not None and (value < -180 or value > 180):
            raise ValueError("Longitude must be between -180 and 180")
        return value


class QuarryCreate(QuarryBase):
    is_active: bool = True
    min_delivery_price: Optional[float] = Field(default=None, ge=0)
    material_ids: Optional[list[UUID]] = None
    material_offers: Optional[list[QuarryMaterialOfferIn]] = None
    delivery_option_ids: Optional[list[UUID]] = None

    @model_validator(mode="after")
    def normalize_references(self):
        self.material_ids = list(dict.fromkeys(self.material_ids or []))
        self.delivery_option_ids = list(dict.fromkeys(self.delivery_option_ids or []))
        self.material_offers = list(self.material_offers or [])
        offer_ids = [offer.material_id for offer in self.material_offers]
        if len(offer_ids) != len(set(offer_ids)):
            raise ValueError("Material offers must be unique")
        return self


class QuarryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    short_name: Optional[str] = Field(default=None, max_length=100)
    point_type: Optional[PickupPointTypeValue] = None
    address: Optional[str] = Field(default=None, max_length=1000)
    description: Optional[str] = Field(default=None, max_length=5000)
    contact_phone: Optional[str] = Field(default=None, max_length=20)
    subscription_end_date: Optional[datetime] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    min_delivery_price: Optional[float] = Field(default=None, ge=0)
    is_active: Optional[bool] = None
    material_ids: Optional[list[UUID]] = None
    material_offers: Optional[list[QuarryMaterialOfferIn]] = None
    delivery_option_ids: Optional[list[UUID]] = None

    model_config = ConfigDict(str_strip_whitespace=True)

    @field_validator("contact_phone", mode="before")
    @classmethod
    def normalize_contact_phone(cls, value: Optional[str]) -> Optional[str]:
        return _normalize_optional_text(value)

    @field_validator("short_name", mode="before")
    @classmethod
    def normalize_short_name(cls, value: Optional[str]) -> Optional[str]:
        return _normalize_optional_text(value)

    @field_validator("description", mode="before")
    @classmethod
    def normalize_description(cls, value: Optional[str]) -> Optional[str]:
        return _normalize_optional_text(value)

    @field_validator("subscription_end_date", mode="before")
    @classmethod
    def normalize_subscription_end_date(cls, value: object) -> object:
        return _normalize_subscription_end_date_value(value)

    @field_validator("lat", mode="before")
    @classmethod
    def validate_lat(cls, value: object) -> Optional[float]:
        value = _normalize_optional_coordinate_value(value)
        if value is None:
            return None
        if value is not None and not -90 <= value <= 90:
            raise ValueError("Latitude must be between -90 and 90")
        return value

    @field_validator("lon", mode="before")
    @classmethod
    def validate_lon(cls, value: object) -> Optional[float]:
        value = _normalize_optional_coordinate_value(value)
        if value is None:
            return None
        if value is not None and not -180 <= value <= 180:
            raise ValueError("Longitude must be between -180 and 180")
        return value


class QuarryOut(QuarryBase):
    id: UUID
    min_delivery_price: Optional[float] = None
    rating: float = 5.0
    is_active: bool
    moderation_status: ModerationStatusValue
    moderation_comment: Optional[str] = None
    owner_user_id: Optional[UUID] = None
    material_ids: list[UUID] = Field(default_factory=list)
    materials: list[QuarryMaterialRef] = Field(default_factory=list)
    material_offers: list[QuarryMaterialOfferOut] = Field(default_factory=list)
    delivery_option_ids: list[UUID] = Field(default_factory=list)
    delivery_options: list[DeliveryOptionOut] = Field(default_factory=list)
    media_files: list[MediaFileOut] = Field(default_factory=list)
    primary_image_url: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class AdminPickupPointOut(QuarryOut):
    owner_name: Optional[str] = None
    owner_phone: Optional[str] = None


class PickupPointMarkerOut(BaseModel):
    id: UUID
    name: str
    short_name: str
    point_type: PickupPointTypeValue
    lat: float
    lon: float
    material_id: UUID
    price: float
    unit: str
    min_delivery_price: float
    primary_image_url: Optional[str] = None


class ModerationDecision(BaseModel):
    comment: Optional[str] = Field(default=None, max_length=2000)


class RejectionDecision(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)

    model_config = ConfigDict(str_strip_whitespace=True)


class SupplierRegisterRequest(BaseModel):
    phone: str = Field(min_length=10, max_length=20)


class SupplierVerifyCodeRequest(BaseModel):
    phone: str = Field(min_length=10, max_length=20)
    code: str = Field(min_length=4, max_length=8)


class SupplierRegistrationOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str = "supplier"


class SupplierSmsChallengeOut(BaseModel):
    status: str = "sms_sent"
    phone: str
