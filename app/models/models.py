import uuid
from datetime import datetime
from enum import Enum as PyEnum
from typing import List, Optional

from sqlalchemy import Float, ForeignKey, String, Text, DateTime, Enum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.database import Base

# Enums
class DriverStatus(str, PyEnum):
    ONLINE = "online"
    FREE = "free"
    BUSY = "busy"
    OFFLINE = "offline"

class OrderStatus(str, PyEnum):
    NEW = "new"
    PROCESSING = "processing"
    ASSIGNING = "assigning"
    ACCEPTED = "accepted"
    IN_PROGRESS = "in_progress"
    DONE = "done"
    CANCELED = "canceled"

class OfferStatus(str, PyEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    TIMEOUT = "timeout"

# Models
class Client(Base):
    __tablename__ = "clients"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    source: Mapped[Optional[str]] = mapped_column(String(100))

    # Relationships
    orders: Mapped[List["Order"]] = relationship("Order", back_populates="client")

class Driver(Base):
    __tablename__ = "drivers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    status: Mapped[DriverStatus] = mapped_column(Enum(DriverStatus), default=DriverStatus.OFFLINE)
    max_integration_id: Mapped[Optional[str]] = mapped_column(String(100))

    # Relationships
    orders: Mapped[List["Order"]] = relationship("Order", back_populates="assigned_driver")
    offers: Mapped[List["OrderOffer"]] = relationship("OrderOffer", back_populates="driver")

class Order(Base):
    __tablename__ = "orders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clients.id"))
    material: Mapped[str] = mapped_column(String(255))
    volume: Mapped[float] = mapped_column(Float)
    address: Mapped[str] = mapped_column(Text)
    status: Mapped[OrderStatus] = mapped_column(Enum(OrderStatus), default=OrderStatus.NEW)
    assigned_driver_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("drivers.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    client: Mapped["Client"] = relationship("Client", back_populates="orders")
    assigned_driver: Mapped[Optional["Driver"]] = relationship("Driver", back_populates="orders")
    offers: Mapped[List["OrderOffer"]] = relationship("OrderOffer", back_populates="order")
    events: Mapped[List["EventLog"]] = relationship("EventLog", back_populates="order")

class OrderOffer(Base):
    __tablename__ = "order_offers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id"))
    driver_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("drivers.id"))
    status: Mapped[OfferStatus] = mapped_column(Enum(OfferStatus), default=OfferStatus.PENDING)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    # Relationships
    order: Mapped["Order"] = relationship("Order", back_populates="offers")
    driver: Mapped["Driver"] = relationship("Driver", back_populates="offers")

class EventLog(Base):
    __tablename__ = "event_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("orders.id"))
    event_type: Mapped[str] = mapped_column(String(100))
    description: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    order: Mapped[Optional["Order"]] = relationship("Order", back_populates="events")
