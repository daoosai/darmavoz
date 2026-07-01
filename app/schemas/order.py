from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    computed_field,
    field_validator,
    model_validator,
)

from app.schemas.catalog import DeliveryOptionOut, MaterialOut
from app.schemas.driver import DriverResponse


CalculationSource = Literal["yandex_auto", "manual", "osrm_auto"]


class OrderItemOut(BaseModel):
    id: UUID
    material_id: UUID
    quantity: int
    volume: float
    price: float | None = None
    amount: float | None = None
    material: MaterialOut | None = None

    model_config = ConfigDict(from_attributes=True)


class CheckoutRequest(BaseModel):
    client_id: UUID | None = Field(default=None, validation_alias=AliasChoices("client_id", "clientId"))
    material_id: UUID = Field(validation_alias=AliasChoices("material_id", "materialId"))
    delivery_option_id: UUID = Field(
        validation_alias=AliasChoices("delivery_option_id", "deliveryOptionId")
    )
    delivery_address: str | None = Field(
        default=None,
        min_length=1,
        max_length=500,
        validation_alias=AliasChoices("delivery_address", "address", "deliveryAddress"),
    )
    address_id: UUID | None = Field(default=None, validation_alias=AliasChoices("address_id", "addressId"))
    delivery_lat: float | None = Field(default=None, validation_alias=AliasChoices("delivery_lat", "deliveryLat"))
    delivery_lon: float | None = Field(default=None, validation_alias=AliasChoices("delivery_lon", "deliveryLon"))
    quarry_id: UUID | None = Field(default=None, validation_alias=AliasChoices("quarry_id", "quarryId"))
    mileage_km: float | None = Field(default=None, validation_alias=AliasChoices("mileage_km", "mileageKm"))
    notes: str | None = None
    source: str | None = "mobile"
    quantity: int = Field(default=1, ge=1)

    model_config = ConfigDict(
        str_strip_whitespace=True,
        populate_by_name=True,
        extra="ignore",
    )

    @field_validator("notes", "source", mode="before")
    @classmethod
    def normalize_optional_strings(cls, value):
        if value is None:
            return None
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value

    @field_validator("delivery_lat", "delivery_lon", "mileage_km", mode="before")
    @classmethod
    def normalize_optional_numbers(cls, value):
        if value is None:
            return None
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return None
        return value

    @field_validator("delivery_lat")
    @classmethod
    def validate_delivery_lat(cls, value: float | None):
        if value is None:
            return value
        if value < -90 or value > 90:
            raise ValueError("Latitude must be between -90 and 90")
        return value

    @field_validator("delivery_lon")
    @classmethod
    def validate_delivery_lon(cls, value: float | None):
        if value is None:
            return value
        if value < -180 or value > 180:
            raise ValueError("Longitude must be between -180 and 180")
        return value

    @field_validator("mileage_km")
    @classmethod
    def validate_mileage_km(cls, value: float | None):
        if value is None:
            return value
        if value <= 0:
            raise ValueError("mileage_km must be greater than 0")
        return round(value, 2)

    @model_validator(mode="after")
    def validate_checkout_requirements(self):
        if not self.delivery_address and self.address_id is None:
            raise ValueError("delivery_address or address_id must be provided")
        if (self.delivery_lat is None) != (self.delivery_lon is None):
            raise ValueError("delivery_lat and delivery_lon must be provided together")
        return self


class ClientOrderCalculationRequest(BaseModel):
    material_id: UUID
    delivery_option_id: UUID
    delivery_lat: float
    delivery_lon: float
    quantity: int = Field(default=1, ge=1)

    model_config = ConfigDict(extra="forbid")

    @field_validator("delivery_lat")
    @classmethod
    def validate_delivery_lat(cls, value: float) -> float:
        if value < -90 or value > 90:
            raise ValueError("Latitude must be between -90 and 90")
        return value

    @field_validator("delivery_lon")
    @classmethod
    def validate_delivery_lon(cls, value: float) -> float:
        if value < -180 or value > 180:
            raise ValueError("Longitude must be between -180 and 180")
        return value


class ClientOrderCalculationOut(BaseModel):
    quarry_id: UUID
    quarry_name: str
    mileage_km: float
    delivery_cost: float
    total_amount: float


class LogistOrderCreate(BaseModel):
    client_name: str | None = Field(default=None, max_length=255)
    client_phone: str = Field(min_length=11, max_length=20)
    material_id: UUID
    delivery_option_id: UUID
    quantity: int = Field(default=1, ge=1)
    quarry_id: UUID | None = Field(default=None, validation_alias=AliasChoices("quarry_id", "quarryId"))
    pickup_address: str | None = Field(default=None, min_length=1, max_length=500)
    pickup_lat: float | None = None
    pickup_lon: float | None = None
    delivery_address: str = Field(
        min_length=1,
        max_length=500,
        validation_alias=AliasChoices("delivery_address", "address"),
    )
    delivery_lat: float | None = None
    delivery_lon: float | None = None
    mileage_km: float | None = Field(default=None, gt=0)
    estimated_total_amount: float | None = Field(
        default=None,
        validation_alias=AliasChoices("estimated_total_amount", "estimatedTotalAmount"),
    )
    calculation_source: CalculationSource = "yandex_auto"
    notes: str | None = Field(default=None, max_length=2000)
    source: str | None = "dispatcher"
    auto_dispatch: bool = True

    model_config = ConfigDict(
        str_strip_whitespace=True,
        populate_by_name=True,
        extra="forbid",
    )

    @field_validator(
        "client_name",
        "client_phone",
        "pickup_address",
        "delivery_address",
        "notes",
        "source",
        mode="before",
    )
    @classmethod
    def normalize_strings(cls, value):
        if value is None:
            return None
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value

    @field_validator(
        "pickup_lat",
        "pickup_lon",
        "delivery_lat",
        "delivery_lon",
        "mileage_km",
        "estimated_total_amount",
        mode="before",
    )
    @classmethod
    def normalize_numbers(cls, value):
        if value is None:
            return None
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return None
        return value

    @field_validator("pickup_lat", "delivery_lat")
    @classmethod
    def validate_lat(cls, value: float | None):
        if value is None:
            return value
        if value < -90 or value > 90:
            raise ValueError("Latitude must be between -90 and 90")
        return value

    @field_validator("pickup_lon", "delivery_lon")
    @classmethod
    def validate_lon(cls, value: float | None):
        if value is None:
            return value
        if value < -180 or value > 180:
            raise ValueError("Longitude must be between -180 and 180")
        return value

    @field_validator("mileage_km")
    @classmethod
    def round_mileage(cls, value: float | None):
        if value is None:
            return value
        return round(value, 2)

    @field_validator("estimated_total_amount")
    @classmethod
    def round_estimated_total_amount(cls, value: float | None):
        if value is None:
            return value
        if value <= 0:
            raise ValueError("estimated_total_amount must be greater than 0")
        return round(value, 2)

    @model_validator(mode="after")
    def validate_route_requirements(self):
        if (self.pickup_lat is None) != (self.pickup_lon is None):
            raise ValueError("pickup_lat and pickup_lon must be provided together")
        if (self.delivery_lat is None) != (self.delivery_lon is None):
            raise ValueError("delivery_lat and delivery_lon must be provided together")

        if self.calculation_source == "yandex_auto":
            if self.quarry_id is None:
                raise ValueError("quarry_id is required for yandex_auto calculation_source")
            if self.delivery_lat is None or self.delivery_lon is None:
                raise ValueError(
                    "delivery coordinates are required for yandex_auto calculation_source"
                )

        if self.calculation_source == "manual":
            if not self.pickup_address:
                raise ValueError("pickup_address is required for manual calculation_source")
            if self.mileage_km is None or self.mileage_km <= 0:
                raise ValueError(
                    "For manual calculation_source, mileage_km must be greater than 0"
                )

        return self


class DriverCancelOrderRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class ManualAssignRequest(BaseModel):
    driver_id: UUID


class ManualOrderAssignIn(ManualAssignRequest):
    pass


class DispatchHistoryAttemptOut(BaseModel):
    offer_id: UUID
    sequence_no: int
    driver_id: UUID
    driver_name: str
    driver_phone: str
    vehicle_title: str | None = None
    status: str
    offered_at: datetime | None = None
    expires_at: datetime | None = None
    responded_at: datetime | None = None
    decision_reason: str | None = None


class DispatchHistoryOut(BaseModel):
    order_id: UUID
    status: str
    assigned_driver_id: UUID | None = None
    attempts: list[DispatchHistoryAttemptOut] = Field(default_factory=list)


class OrderOut(BaseModel):
    id: UUID
    client_id: UUID
    driver_id: UUID | None = None
    delivery_option_id: UUID | None = None
    quarry_id: UUID | None = None
    current_offer_id: UUID | None = None
    address: str | None = None
    pickup_address: str | None = None
    pickup_lat: float | None = None
    pickup_lon: float | None = None
    delivery_address: str | None = None
    delivery_lat: float | None = None
    delivery_lon: float | None = None
    mileage_km: float | None = None
    delivery_rate_per_km_snapshot: float | None = None
    delivery_cost: float | None = None
    calculation_source: CalculationSource | None = None
    route_calculated_at: datetime | None = None
    total_amount: float
    status: str
    source: str | None = None
    created_by_source: str | None = None
    notes: str | None = None
    quantity: int = 0
    dispatch_started_at: datetime | None = None
    assigned_at: datetime | None = None
    created_at: datetime
    delivery_option: DeliveryOptionOut | None = None
    driver: DriverResponse | None = None
    items: list[OrderItemOut] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)

    @computed_field(return_type=float)
    @property
    def estimated_total_amount(self) -> float:
        return round((self.total_amount or 0.0) + (self.delivery_cost or 0.0), 2)


DriverOrderStatusValue = Literal[
    "heading_to_quarry",
    "heading_to_client",
    "in_progress",
    "completed",
]


class DriverOrderStatusUpdate(BaseModel):
    status: DriverOrderStatusValue

    model_config = ConfigDict(extra="forbid")


class DriverAssignedOrderOut(BaseModel):
    order_id: UUID | None = None
    status: str | None = None
    assigned_at: datetime | None = None
    order: OrderOut | None = None


class OrderDeleteOut(BaseModel):
    ok: bool
    message: str
