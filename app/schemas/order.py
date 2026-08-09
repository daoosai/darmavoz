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

from app.schemas.catalog import DeliveryOptionOut, MaterialOut, MediaFileOut
from app.schemas.driver import DriverResponse
from app.services.storage import normalize_public_url


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
    expected_material_unit_price: float | None = Field(
        default=None,
        gt=0,
        validation_alias=AliasChoices("expected_material_unit_price", "expectedMaterialUnitPrice"),
    )
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
    quarry_id: UUID | None = None
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


class ClientOrderCalculationOptionOut(BaseModel):
    quarry_id: UUID
    quarry_name: str
    point_type: str
    rating: float = 5.0
    is_vip: bool = False
    manual_priority: int = 0
    distance: float
    material_cost: float
    delivery_cost: float
    total_amount: float
    primary_image_url: str | None = None
    media_files: list[MediaFileOut] = Field(default_factory=list)

    @field_validator("primary_image_url")
    @classmethod
    def normalize_pickup_point_image_url(cls, value: str | None) -> str | None:
        return normalize_public_url(value)


class ClientOrderCalculationOut(BaseModel):
    best_option: ClientOrderCalculationOptionOut
    alternatives: list[ClientOrderCalculationOptionOut] = Field(default_factory=list)


class LogistOrderCreate(BaseModel):
    client_name: str | None = Field(default=None, max_length=255)
    client_phone: str = Field(min_length=11, max_length=20)
    driver_id: UUID | None = Field(default=None, validation_alias=AliasChoices("driver_id", "driverId"))
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
    total_amount: float | None = Field(
        default=None,
        gt=0,
        validation_alias=AliasChoices("total_amount", "totalAmount", "material_cost", "materialCost"),
    )
    delivery_cost: float | None = Field(
        default=None,
        ge=0,
        validation_alias=AliasChoices("delivery_cost", "deliveryCost"),
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
        "total_amount",
        "delivery_cost",
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

    @field_validator("total_amount", "delivery_cost")
    @classmethod
    def round_money_amounts(cls, value: float | None):
        if value is None:
            return value
        return round(value, 2)

    @model_validator(mode="after")
    def validate_route_requirements(self):
        if (self.pickup_lat is None) != (self.pickup_lon is None):
            raise ValueError("pickup_lat and pickup_lon must be provided together")
        if (self.delivery_lat is None) != (self.delivery_lon is None):
            raise ValueError("delivery_lat and delivery_lon must be provided together")

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


class OrderUpdate(BaseModel):
    client_name: str | None = Field(default=None, max_length=255, validation_alias=AliasChoices("client_name", "clientName"))
    client_phone: str | None = Field(
        default=None,
        min_length=11,
        max_length=20,
        validation_alias=AliasChoices("client_phone", "clientPhone"),
    )
    notes: str | None = Field(default=None, max_length=2000)
    delivery_address: str | None = Field(
        default=None,
        min_length=1,
        max_length=500,
        validation_alias=AliasChoices("delivery_address", "deliveryAddress", "address"),
    )
    delivery_lat: float | None = Field(default=None, validation_alias=AliasChoices("delivery_lat", "deliveryLat"))
    delivery_lon: float | None = Field(default=None, validation_alias=AliasChoices("delivery_lon", "deliveryLon"))
    material_id: UUID | None = Field(default=None, validation_alias=AliasChoices("material_id", "materialId"))
    delivery_option_id: UUID | None = Field(
        default=None,
        validation_alias=AliasChoices("delivery_option_id", "deliveryOptionId", "vehicle_type_id", "vehicleTypeId"),
    )
    quarry_id: UUID | None = Field(default=None, validation_alias=AliasChoices("quarry_id", "quarryId"))
    total_amount: float | None = Field(
        default=None,
        gt=0,
        validation_alias=AliasChoices("total_amount", "totalAmount", "material_cost", "materialCost"),
    )
    delivery_cost: float | None = Field(
        default=None,
        ge=0,
        validation_alias=AliasChoices("delivery_cost", "deliveryCost"),
    )

    model_config = ConfigDict(
        str_strip_whitespace=True,
        populate_by_name=True,
        extra="forbid",
    )

    @field_validator("client_name", "client_phone", "notes", "delivery_address", mode="before")
    @classmethod
    def normalize_strings(cls, value):
        if value is None:
            return None
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value

    @field_validator("delivery_lat", "delivery_lon", "total_amount", "delivery_cost", mode="before")
    @classmethod
    def normalize_numbers(cls, value):
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

    @field_validator("total_amount", "delivery_cost")
    @classmethod
    def validate_money_amounts(cls, value: float | None):
        if value is None:
            return value
        return round(value, 2)

    @model_validator(mode="after")
    def validate_coordinates_pair(self):
        if (self.delivery_lat is None) != (self.delivery_lon is None):
            raise ValueError("delivery_lat and delivery_lon must be provided together")
        return self


class ClarificationResolveRequest(BaseModel):
    comment: str | None = Field(default=None, max_length=2000)

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


class OrderHistoryEventOut(BaseModel):
    id: UUID
    status: str
    event_type: str
    description: str | None = None
    created_at: datetime


class OrderHistoryOut(BaseModel):
    order_id: UUID
    current_status: str
    events: list[OrderHistoryEventOut] = Field(default_factory=list)


class OrderOut(BaseModel):
    id: UUID
    client_id: UUID
    client_name: str | None = None
    client_phone: str | None = None
    driver_id: UUID | None = None
    delivery_option_id: UUID | None = None
    quarry_id: UUID | None = None
    pickup_point_type: str | None = None
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
    is_deleted: bool = False
    status: str
    source: str | None = None
    created_by_source: str | None = None
    notes: str | None = None
    quantity: int = 0
    clarification_reasons: list[str] = Field(default_factory=list)
    clarification_comment: str | None = None
    clarification_requested_at: datetime | None = None
    clarification_resolved_at: datetime | None = None
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

    @computed_field(return_type=float)
    @property
    def total_price(self) -> float:
        return self.estimated_total_amount


class DriverOrderOut(OrderOut):
    client_phone: str | None = None
    client_name: str | None = None
    quarry_name: str | None = None


class DriverOrderStatusUpdate(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        normalized = value.strip()
        legacy_aliases = {
            "heading_to_quarry": "heading_to_pickup",
            "in_progress": "loading",
        }
        normalized = legacy_aliases.get(normalized, normalized)
        allowed_statuses = {
            "driver_accepted",
            "heading_to_pickup",
            "arrived_at_pickup",
            "loading",
            "heading_to_client",
            "delivered",
            "completed",
        }
        if normalized not in allowed_statuses:
            raise ValueError("Unsupported driver order status")
        return normalized

    model_config = ConfigDict(extra="forbid")


class DriverAssignedOrderOut(BaseModel):
    order_id: UUID | None = None
    status: str | None = None
    assigned_at: datetime | None = None
    order: DriverOrderOut | None = None


class OrderDeleteOut(BaseModel):
    ok: bool
    message: str
