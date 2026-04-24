import uuid
from datetime import datetime
from typing import List, Optional

from sqlalchemy import ForeignKey, String, Text, DateTime, Boolean, Float, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship, DeclarativeBase
from sqlalchemy.sql import func

class Base(DeclarativeBase):
    pass

class Role(Base):
    __tablename__ = 'roles'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(50), unique=True) # admin, logist, manager
    description: Mapped[Optional[str]] = mapped_column(String(255))

    # Relationships
    users: Mapped[List["User"]] = relationship("User", back_populates="role")

class User(Base):
    __tablename__ = 'users'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roles.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Relationships
    role: Mapped["Role"] = relationship("Role", back_populates="users")

class Client(Base):
    __tablename__ = 'clients'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255))
    phone: Mapped[Optional[str]] = mapped_column(String(20), unique=True, index=True, nullable=True)
    external_source: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    external_user_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    __table_args__ = (
        UniqueConstraint('external_source', 'external_user_id', name='uq_client_ext_source_id'),
    )

    # Relationships
    orders: Mapped[List["Order"]] = relationship("Order", back_populates="client")
    dialogues: Mapped[List["Dialogue"]] = relationship("Dialogue", back_populates="client")

class Driver(Base):
    __tablename__ = 'drivers'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    status: Mapped[Optional[str]] = mapped_column(String(50))

    # Relationships
    orders: Mapped[List["Order"]] = relationship("Order", back_populates="driver")

class Order(Base):
    __tablename__ = 'orders'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clients.id"))
    driver_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("drivers.id"), nullable=True)
    material: Mapped[str] = mapped_column(String(255))
    volume: Mapped[float] = mapped_column(Float)
    address: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50))

    # Relationships
    client: Mapped["Client"] = relationship("Client", back_populates="orders")
    driver: Mapped[Optional["Driver"]] = relationship("Driver", back_populates="orders")
    events: Mapped[List["EventLog"]] = relationship("EventLog", back_populates="order")
    offers: Mapped[List["OrderOffer"]] = relationship("OrderOffer", back_populates="order")
    dialogues: Mapped[List["Dialogue"]] = relationship("Dialogue", back_populates="order")

class EventLog(Base):
    __tablename__ = 'events'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("orders.id"), nullable=True)
    event_type: Mapped[str] = mapped_column(String(100))
    description: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    order: Mapped[Optional["Order"]] = relationship("Order", back_populates="events")

class OrderOffer(Base):
    __tablename__ = 'order_offers'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id"))
    driver_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("drivers.id"))
    price: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(50)) # pending, accepted, rejected
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    order: Mapped["Order"] = relationship("Order", back_populates="offers")
    driver: Mapped["Driver"] = relationship("Driver")

class IntegrationEvent(Base):
    __tablename__ = 'integration_events'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source: Mapped[str] = mapped_column(String(50))
    external_event_id: Mapped[str] = mapped_column(String(255))
    payload: Mapped[dict] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(50)) # received, processed, failed
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('source', 'external_event_id', name='uix_integration_events_source_external_id'),
    )

class Channel(Base):
    __tablename__ = 'channels'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(50))
    external_account_id: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    __table_args__ = (
        UniqueConstraint('name', 'external_account_id', name='uix_channels_name_external_id'),
    )

    # Relationships
    dialogues: Mapped[List["Dialogue"]] = relationship("Dialogue", back_populates="channel", cascade="all, delete-orphan")

class Dialogue(Base):
    __tablename__ = 'dialogues'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    channel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("channels.id"))
    external_dialog_id: Mapped[str] = mapped_column(String(255))
    client_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("clients.id"), nullable=True)
    order_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("orders.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(50)) # open, closed
    last_message_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('channel_id', 'external_dialog_id', name='uix_dialogues_channel_external_id'),
    )

    # Relationships
    channel: Mapped["Channel"] = relationship("Channel", back_populates="dialogues")
    client: Mapped[Optional["Client"]] = relationship("Client", back_populates="dialogues")
    order: Mapped[Optional["Order"]] = relationship("Order", back_populates="dialogues")
    messages: Mapped[List["Message"]] = relationship("Message", back_populates="dialogue", cascade="all, delete-orphan")

class Message(Base):
    __tablename__ = 'messages'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dialogue_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("dialogues.id"))
    external_message_id: Mapped[str] = mapped_column(String(255))
    direction: Mapped[str] = mapped_column(String(50)) # inbound, outbound
    message_type: Mapped[str] = mapped_column(String(50)) # text, system, media
    text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    raw_payload: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('dialogue_id', 'external_message_id', name='uix_messages_dialogue_external_id'),
    )

    # Relationships
    dialogue: Mapped["Dialogue"] = relationship("Dialogue", back_populates="messages")
