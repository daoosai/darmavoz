import uuid
from datetime import datetime
from enum import Enum
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


class Product(Base):
    __tablename__ = 'products'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    price: Mapped[float] = mapped_column(Float, nullable=False)
    unit_type: Mapped[str] = mapped_column(String(50), nullable=False)
    image_url: Mapped[str] = mapped_column(String(500), nullable=False)


class OrderStatus(str, Enum):
    draft = "draft"
    pending = "pending"
    assigned = "assigned"
    completed = "completed"
    cancelled = "cancelled"

class Order(Base):
    __tablename__ = 'orders'


    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clients.id"))
    driver_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("drivers.id"), nullable=True)
    address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    total_amount: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(50), default=OrderStatus.draft.value)
    source: Mapped[Optional[str]] = mapped_column(String(50), default="avito", nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_dialogue_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("dialogues.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    client: Mapped["Client"] = relationship("Client", back_populates="orders")
    driver: Mapped[Optional["Driver"]] = relationship("Driver", back_populates="orders")
    items: Mapped[List["OrderItem"]] = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")
    events: Mapped[List["EventLog"]] = relationship("EventLog", back_populates="order")
    offers: Mapped[List["OrderOffer"]] = relationship("OrderOffer", back_populates="order")
    dialogues: Mapped[List["Dialogue"]] = relationship(
        "Dialogue",
        back_populates="order",
        foreign_keys="Dialogue.order_id",
    )
    source_dialogue: Mapped[Optional["Dialogue"]] = relationship("Dialogue", foreign_keys=[source_dialogue_id])

class OrderItem(Base):
    __tablename__ = 'order_items'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id"))
    material_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("materials.id"))
    volume: Mapped[float] = mapped_column(Float, nullable=False)
    price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Relationships
    order: Mapped["Order"] = relationship("Order", back_populates="items")
    material: Mapped["Material"] = relationship("Material")

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
    order: Mapped[Optional["Order"]] = relationship(
        "Order",
        back_populates="dialogues",
        foreign_keys=[order_id],
    )
    messages: Mapped[List["Message"]] = relationship("Message", back_populates="dialogue", cascade="all, delete-orphan")
    ai_analyses: Mapped[List["MessageAiAnalysis"]] = relationship("MessageAiAnalysis", back_populates="dialogue", cascade="all, delete-orphan")

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
    ai_analyses: Mapped[List["MessageAiAnalysis"]] = relationship("MessageAiAnalysis", back_populates="message", cascade="all, delete-orphan")


class MessageAiAnalysis(Base):
    __tablename__ = 'message_ai_analyses'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("messages.id"))
    dialogue_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("dialogues.id"))
    classification: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    raw_llm_response: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    normalized_json: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    confidence: Mapped[float] = mapped_column(Float)
    missing_fields: Mapped[Optional[list[str]]] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(String(50))
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    message: Mapped["Message"] = relationship("Message", back_populates="ai_analyses")
    dialogue: Mapped["Dialogue"] = relationship("Dialogue", back_populates="ai_analyses")


class Category(Base):
    __tablename__ = 'categories'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(default=True)

    # Relationships
    materials: Mapped[List["Material"]] = relationship("Material", back_populates="category", cascade="all, delete-orphan")


class Material(Base):
    __tablename__ = 'materials'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("categories.id"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    unit: Mapped[str] = mapped_column(String(50), nullable=False)
    min_volume: Mapped[float] = mapped_column(Float, default=1.0)
    image_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True)
    sort_order: Mapped[int] = mapped_column(default=0)

    # Relationships
    category: Mapped["Category"] = relationship("Category", back_populates="materials")
    cart_items: Mapped[List["CartItem"]] = relationship("CartItem", back_populates="material")


class CartItem(Base):
    __tablename__ = 'cart_items'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_key: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    material_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("materials.id"))
    volume: Mapped[float] = mapped_column(Float, nullable=False)
    unit_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    material: Mapped["Material"] = relationship("Material", back_populates="cart_items")
