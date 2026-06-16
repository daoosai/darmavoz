from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

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
    address: str
    notes: str | None = None
    source: str | None = "mobile"
    quantity: int = Field(default=1, ge=1)


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
