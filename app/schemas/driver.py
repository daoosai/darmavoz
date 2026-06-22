from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.catalog import DeliveryOptionOut, MediaFileOut


class DriverRegisterVehicleType(str, Enum):
    dump_truck = "самосвал"
    flatbed = "бортовой"
    box_van = "будка"


class VehicleCreate(BaseModel):
    title: str
    brand: str | None = None
    model: str | None = None
    plate_number: str | None = None
    vehicle_type: str | None = None
    body_volume_m3: float | None = None
    cubature_min: float | None = None
    cubature_max: float | None = None
    tonnage_min: float | None = None
    tonnage_max: float | None = None
    delivery_option_id: UUID | None = None
    rate_mode: str | None = None
    rate_per_ton_km: float | None = None
    fixed_rate: float | None = None
    is_active: bool = True
    notes: str | None = None


class VehicleOut(BaseModel):
    id: UUID
    title: str
    brand: str | None = None
    model: str | None = None
    plate_number: str | None = None
    vehicle_type: str | None = None
    body_volume_m3: float | None = None
    cubature_min: float | None = None
    cubature_max: float | None = None
    tonnage_min: float | None = None
    tonnage_max: float | None = None
    delivery_option_id: UUID | None = None
    rate_mode: str | None = None
    rate_per_ton_km: float | None = None
    fixed_rate: float | None = None
    is_active: bool
    notes: str | None = None
    moderation_status: str
    moderation_comment: str | None = None
    moderated_at: datetime | None = None
    created_at: datetime
    media_files: list[MediaFileOut] = Field(default_factory=list)
    delivery_option: DeliveryOptionOut | None = None

    model_config = ConfigDict(from_attributes=True)


class DriverCreate(BaseModel):
    name: str
    phone: str
    status: str | None = None
    vehicle_id: UUID | None = None
    is_auto_dispatch_enabled: bool = True
    dispatch_priority: int = 100


class AdminDriverCreate(BaseModel):
    name: str
    phone: str
    password: str = Field(min_length=6, max_length=128)
    vehicle_brand: str = Field(min_length=1, max_length=255)
    vehicle_plate_number: str = Field(min_length=1, max_length=50)
    vehicle_type: DriverRegisterVehicleType
    cubature_min: float
    cubature_max: float
    tonnage_min: float
    tonnage_max: float
    status: str = "offline"
    is_active: bool = True
    is_auto_dispatch_enabled: bool = True
    dispatch_priority: int = 100

    @field_validator("vehicle_type", mode="before")
    @classmethod
    def normalize_vehicle_type(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip().lower()
        return value

    @model_validator(mode="after")
    def validate_ranges(self) -> "AdminDriverCreate":
        if self.cubature_max < self.cubature_min:
            raise ValueError("cubature_max must be greater than or equal to cubature_min")
        if self.tonnage_max < self.tonnage_min:
            raise ValueError("tonnage_max must be greater than or equal to tonnage_min")
        return self


class AdminDriverUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    password: str | None = Field(default=None, min_length=6, max_length=128)
    delivery_option_id: UUID | None = None
    vehicle_id: UUID | None = None
    status: str | None = None
    is_active: bool | None = None
    is_auto_dispatch_enabled: bool | None = None
    dispatch_priority: int | None = None


class DriverRegisterRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    name: str = Field(
        min_length=1,
        max_length=255,
        validation_alias=AliasChoices("name", "full_name"),
    )
    phone: str
    password: str = Field(min_length=6, max_length=128)
    vehicle_brand: str = Field(min_length=1, max_length=255)
    vehicle_plate_number: str = Field(min_length=1, max_length=50)
    cubature_min: float
    cubature_max: float
    tonnage_min: float
    tonnage_max: float
    vehicle_type: DriverRegisterVehicleType

    @field_validator("vehicle_type", mode="before")
    @classmethod
    def normalize_vehicle_type(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip().lower()
        return value

    @model_validator(mode="after")
    def validate_ranges(self) -> "DriverRegisterRequest":
        if self.cubature_max < self.cubature_min:
            raise ValueError("cubature_max must be greater than or equal to cubature_min")
        if self.tonnage_max < self.tonnage_min:
            raise ValueError("tonnage_max must be greater than or equal to tonnage_min")
        return self


class DriverProfileUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None


class DriverVehicleUpdate(BaseModel):
    brand: str | None = None
    model: str | None = None
    plate_number: str | None = None
    vehicle_type: str | None = None
    body_volume_m3: float | None = None
    cubature_min: float | None = None
    cubature_max: float | None = None
    tonnage_min: float | None = None
    tonnage_max: float | None = None
    delivery_option_id: UUID | None = None
    rate_mode: str | None = None
    rate_per_ton_km: float | None = None
    fixed_rate: float | None = None
    is_active: bool | None = None
    notes: str | None = None


class DriverStatusUpdate(BaseModel):
    status: str


class DriverResponse(BaseModel):
    id: UUID
    name: str
    phone: str
    status: str | None = None
    vehicle_id: UUID | None = None
    is_auto_dispatch_enabled: bool = True
    dispatch_priority: int = 100
    temporary_penalty_until: datetime | None = None
    last_offer_at: datetime | None = None
    moderation_status: str
    moderation_comment: str | None = None
    moderated_at: datetime | None = None
    vehicle: VehicleOut | None = None

    model_config = ConfigDict(from_attributes=True)


class DriverFleetResponse(DriverResponse):
    vehicle_type: str | None = None
    vehicle_cubature_min: float | None = None
    vehicle_cubature_max: float | None = None
    vehicle_tonnage_min: float | None = None
    vehicle_tonnage_max: float | None = None
    vehicle_main_url: str | None = None
    vehicle_left_url: str | None = None


class DriverRegistrationResponse(BaseModel):
    access_token: str
    token_type: str
    role: str | None = None
    driver_id: UUID | None = None
    driver: DriverResponse


class DriverFullProfileResponse(DriverResponse):
    pass


class DriverDispatchCandidateOut(BaseModel):
    id: UUID
    name: str
    phone: str
    status: str
    dispatch_priority: int
    temporary_penalty_until: datetime | None = None
    vehicle: VehicleOut | None = None

    model_config = ConfigDict(from_attributes=True)


class DriverOfferOrderOut(BaseModel):
    id: UUID
    material_name: str
    quantity: int
    address: str | None = None
    notes: str | None = None
    client_phone_masked: str | None = None
    delivery_option: DeliveryOptionOut | None = None


class DriverIncomingOfferOut(BaseModel):
    offer_id: UUID | None = None
    order_id: UUID | None = None
    status: str | None = None
    expires_at: datetime | None = None
    seconds_left: int | None = None
    order: DriverOfferOrderOut | None = None


class DriverOfferDecisionIn(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class DriverOfferDecisionOut(BaseModel):
    ok: bool
    offer_status: str
    order_id: UUID
    order_status: str | None = None
    driver_status: str | None = None
    next_attempt_started: bool | None = None


class PendingModerationItemOut(BaseModel):
    driver_id: UUID
    driver_name: str
    driver_phone: str
    driver_moderation_status: str
    driver_moderation_comment: str | None = None
    vehicle_id: UUID
    vehicle_brand: str | None = None
    vehicle_model: str | None = None
    vehicle_plate_number: str | None = None
    vehicle_cubature_min: float | None = None
    vehicle_cubature_max: float | None = None
    vehicle_tonnage_min: float | None = None
    vehicle_tonnage_max: float | None = None
    vehicle_type: str | None = None
    vehicle_moderation_status: str
    vehicle_moderation_comment: str | None = None
    vehicle_main_url: str | None = None
    vehicle_left_url: str | None = None
    vehicle_plate_url: str | None = None
    media_files: list[MediaFileOut] = Field(default_factory=list)


class VehicleModerationDecisionOut(BaseModel):
    ok: bool
    moderation_status: str
    moderation_comment: str | None = None
    driver_moderation_status: str | None = None
    driver_moderation_comment: str | None = None
