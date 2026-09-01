from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.catalog import DeliveryOptionOut, MediaFileOut
from app.services.storage import normalize_public_url


def _validate_password(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if len(normalized) < 6:
        raise ValueError("Пароль должен содержать минимум 6 символов")
    if len(normalized) > 128:
        raise ValueError("Пароль должен содержать не более 128 символов")
    return normalized


class VehicleCreate(BaseModel):
    title: str
    brand: str | None = None
    model: str | None = None
    plate_number: str | None = None
    vehicle_type: str | None = None
    body_volume_m3: float | None = None
    delivery_option_id: UUID
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
    password: str
    delivery_option_id: UUID
    status: str = "offline"
    is_active: bool = True
    is_auto_dispatch_enabled: bool = True
    dispatch_priority: int = 100
    rating: float = Field(default=5.0, ge=1, le=5)
    is_dispatch_eligible: bool = True
    dispatch_admission_score: int = Field(default=100, ge=0, le=100)
    dispatch_admission_comment: str | None = Field(default=None, max_length=2000)
    vehicle_brand: str | None = None
    vehicle_plate_number: str | None = None
    vehicle_type: str | None = None
    cubature_min: float | None = None
    cubature_max: float | None = None
    tonnage_min: float | None = None
    tonnage_max: float | None = None

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        validated = _validate_password(value)
        assert validated is not None
        return validated


class AdminDriverUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    password: str | None = None
    delivery_option_id: UUID | None = None
    vehicle_id: UUID | None = None
    status: str | None = None
    is_active: bool | None = None
    is_auto_dispatch_enabled: bool | None = None
    dispatch_priority: int | None = None
    rating: float | None = Field(default=None, ge=1, le=5)
    is_dispatch_eligible: bool | None = None
    dispatch_admission_score: int | None = Field(default=None, ge=0, le=100)
    dispatch_admission_comment: str | None = Field(default=None, max_length=2000)
    vehicle_brand: str | None = None
    vehicle_plate_number: str | None = None
    vehicle_type: str | None = None
    cubature_min: float | None = None
    cubature_max: float | None = None
    tonnage_min: float | None = None
    tonnage_max: float | None = None

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str | None) -> str | None:
        return _validate_password(value)


class DriverRegisterRequest(BaseModel):
    phone: str
    password: str
    name: str | None = None
    vehicle_brand: str | None = None
    vehicle_plate_number: str | None = None
    vehicle_type: str | None = None
    cubature_min: float | None = None
    cubature_max: float | None = None
    tonnage_min: float | None = None
    tonnage_max: float | None = None

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        validated = _validate_password(value)
        assert validated is not None
        return validated

class DriverProfileUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None


class DriverVehicleUpdate(BaseModel):
    brand: str | None = None
    model: str | None = None
    plate_number: str | None = None
    vehicle_type: str | None = None
    body_volume_m3: float | None = None
    delivery_option_id: UUID | None = None
    rate_mode: str | None = None
    rate_per_ton_km: float | None = None
    fixed_rate: float | None = None
    is_active: bool | None = None
    notes: str | None = None


class DriverStatusUpdate(BaseModel):
    status: str


class DriverShiftUpdate(BaseModel):
    is_on_shift: bool


class DriverShiftOut(BaseModel):
    ok: bool
    is_on_shift: bool
    status: str


class DriverLocationUpdate(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class DriverLocationUpdateOut(BaseModel):
    ok: bool
    received_at: datetime


class DriverFcmTokenIn(BaseModel):
    token: str = Field(min_length=1, max_length=1024)

    @field_validator("token")
    @classmethod
    def validate_token(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Токен не должен быть пустым")
        return normalized


class DriverFcmTokenOut(BaseModel):
    ok: bool
    token: str | None = None


class DriverResponse(BaseModel):
    id: UUID
    name: str
    phone: str
    status: str | None = None
    is_on_shift: bool = False
    last_lat: float | None = None
    last_lon: float | None = None
    last_location_updated_at: datetime | None = None
    vehicle_id: UUID | None = None
    is_auto_dispatch_enabled: bool = True
    dispatch_priority: int = 100
    rating: float = 5.0
    is_dispatch_eligible: bool = True
    dispatch_admission_score: int = 100
    dispatch_admission_comment: str | None = None
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

    @field_validator("vehicle_main_url", "vehicle_left_url")
    @classmethod
    def normalize_fleet_vehicle_urls(cls, value: str | None) -> str | None:
        return normalize_public_url(value)


class DriverMapResponse(BaseModel):
    id: UUID
    name: str
    phone: str
    is_on_shift: bool
    map_status: str
    last_lat: float | None = None
    last_lon: float | None = None
    last_location_updated_at: datetime | None = None
    last_location_is_stale: bool
    vehicle_id: UUID
    vehicle_title: str
    vehicle_plate_number: str | None = None
    vehicle_type: str | None = None
    vehicle_cubature_min: float | None = None
    vehicle_cubature_max: float | None = None
    vehicle_tonnage_min: float | None = None
    vehicle_tonnage_max: float | None = None


class DriverRegistrationResponse(BaseModel):
    access_token: str
    token_type: str
    role: str | None = None
    driver_id: UUID | None = None
    driver: DriverResponse


class DriverSmsChallengeResponse(BaseModel):
    status: str
    phone: str


class DriverVerifyCodeRequest(BaseModel):
    phone: str
    code: str = Field(min_length=4, max_length=4)

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        normalized = value.strip()
        if len(normalized) != 4 or not normalized.isdigit():
            raise ValueError("Код должен состоять из 4 цифр")
        return normalized


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
    pickup_address: str | None = None
    pickup_lat: float | None = None
    pickup_lon: float | None = None
    delivery_address: str | None = None
    delivery_lat: float | None = None
    delivery_lon: float | None = None
    notes: str | None = None
    client_phone_masked: str | None = None
    total_amount: float = 0.0
    delivery_cost: float | None = None
    estimated_total_amount: float = 0.0
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
    vehicle_body_volume_m3: float | None = None
    vehicle_type: str | None = None
    vehicle_cubature_min: float | None = None
    vehicle_cubature_max: float | None = None
    vehicle_tonnage_min: float | None = None
    vehicle_tonnage_max: float | None = None
    vehicle_moderation_status: str
    vehicle_moderation_comment: str | None = None
    vehicle_main_url: str | None = None
    vehicle_left_url: str | None = None
    vehicle_plate_url: str | None = None
    media_files: list[MediaFileOut] = Field(default_factory=list)

    @field_validator("vehicle_main_url", "vehicle_left_url", "vehicle_plate_url")
    @classmethod
    def normalize_pending_vehicle_urls(cls, value: str | None) -> str | None:
        return normalize_public_url(value)


class VehicleModerationDecisionOut(BaseModel):
    ok: bool
    moderation_status: str
    moderation_comment: str | None = None
    driver_moderation_status: str | None = None
    driver_moderation_comment: str | None = None



class AdminCarDriverOut(BaseModel):
    id: UUID
    name: str
    phone: str
    status: str


class AdminCarOut(BaseModel):
    id: UUID
    plate_number: str | None = None
    volume: float | None = None
    car_type: str | None = None
    photo_url: str | None = None
    driver: AdminCarDriverOut

    @field_validator("photo_url")
    @classmethod
    def normalize_car_photo_url(cls, value: str | None) -> str | None:
        return normalize_public_url(value)


class AdminCarStatsOut(BaseModel):
    volume_5: int = Field(default=0, alias="5")
    volume_10: int = Field(default=0, alias="10")
    volume_17: int = Field(default=0, alias="17")
    volume_20: int = Field(default=0, alias="20")
    volume_25: int = Field(default=0, alias="25")
    volume_30: int = Field(default=0, alias="30")

    model_config = ConfigDict(populate_by_name=True)
