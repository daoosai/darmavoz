from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.catalog import DeliveryOptionOut


class VehicleCreate(BaseModel):
    title: str
    plate_number: str | None = None
    delivery_option_id: UUID
    is_active: bool = True
    notes: str | None = None


class VehicleOut(BaseModel):
    id: UUID
    title: str
    plate_number: str | None = None
    delivery_option_id: UUID
    is_active: bool
    notes: str | None = None
    created_at: datetime
    delivery_option: DeliveryOptionOut | None = None

    model_config = ConfigDict(from_attributes=True)


class DriverCreate(BaseModel):
    name: str
    phone: str
    status: str | None = None
    vehicle_id: UUID | None = None
    is_auto_dispatch_enabled: bool = True
    dispatch_priority: int = 100


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
    vehicle: VehicleOut | None = None

    model_config = ConfigDict(from_attributes=True)


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


class DriverAssignedOrderOut(BaseModel):
    order_id: UUID | None = None
    status: str | None = None
    assigned_at: datetime | None = None
    order: DriverOfferOrderOut | None = None
