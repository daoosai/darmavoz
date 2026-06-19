from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.catalog import DeliveryOptionOut, MaterialOut
from app.schemas.driver import DriverResponse


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
    client_id: UUID | None = None
    material_id: UUID
    delivery_option_id: UUID
    address: str | None = None
    delivery_address: str | None = None
    address_id: UUID | None = None
    delivery_lat: float | None = None
    delivery_lon: float | None = None
    notes: str | None = None
    source: str | None = "mobile"
    quantity: int = Field(default=1, ge=1)

    @model_validator(mode="after")
    def validate_address_source(self):
        if not self.address and not self.delivery_address and self.address_id is None:
            raise ValueError("Either address, delivery_address or address_id must be provided")
        return self


class LogistOrderCreate(BaseModel):
    client_name: str
    client_phone: str
    material_id: UUID
    delivery_option_id: UUID
    address: str
    notes: str | None = None
    source: str | None = "dispatcher"
    quantity: int = Field(default=1, ge=1)
    auto_dispatch: bool = True


class ManualAssignRequest(BaseModel):
    driver_id: UUID


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
    current_offer_id: UUID | None = None
    address: str | None = None
    delivery_address: str | None = None
    delivery_lat: float | None = None
    delivery_lon: float | None = None
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


class DriverAssignedOrderOut(BaseModel):
    order_id: UUID | None = None
    status: str | None = None
    assigned_at: datetime | None = None
    order: OrderOut | None = None


class OrderDeleteOut(BaseModel):
    ok: bool
    message: str
