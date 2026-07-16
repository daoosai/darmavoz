import uuid
from datetime import date, datetime, time
from enum import Enum
from typing import List, Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Enum as SQLEnum,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Table,
    Text,
    Time,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    pass


quarry_materials = Table(
    "quarry_materials",
    Base.metadata,
    Column("quarry_id", UUID(as_uuid=True), ForeignKey("quarries.id"), primary_key=True),
    Column("material_id", UUID(as_uuid=True), ForeignKey("materials.id"), primary_key=True),
    Column("price", Numeric(12, 2), nullable=True),
    Column("is_active", Boolean, nullable=False, default=True, server_default="true"),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)


quarry_delivery_options = Table(
    "quarry_delivery_options",
    Base.metadata,
    Column("quarry_id", UUID(as_uuid=True), ForeignKey("quarries.id"), primary_key=True),
    Column(
        "delivery_option_id",
        UUID(as_uuid=True),
        ForeignKey("delivery_options.id"),
        primary_key=True,
    ),
    Column("is_active", Boolean, nullable=False, default=True, server_default="true"),
)


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    description: Mapped[Optional[str]] = mapped_column(String(255))

    users: Mapped[List["User"]] = relationship("User", back_populates="role")


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    display_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), unique=True, index=True, nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roles.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    fcm_token: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)

    role: Mapped["Role"] = relationship("Role", back_populates="users")
    driver_profile: Mapped[Optional["Driver"]] = relationship(
        "Driver",
        back_populates="user",
        uselist=False,
        foreign_keys="Driver.user_id",
    )
    pickup_points: Mapped[List["Quarry"]] = relationship(
        "Quarry",
        back_populates="owner",
        foreign_keys="Quarry.owner_user_id",
    )


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255))
    email: Mapped[Optional[str]] = mapped_column(String(255), unique=True, index=True, nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(20), unique=True, index=True, nullable=True)
    fcm_token: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    external_source: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    external_user_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    __table_args__ = (
        UniqueConstraint("external_source", "external_user_id", name="uq_client_ext_source_id"),
    )

    orders: Mapped[List["Order"]] = relationship("Order", back_populates="client")
    dialogues: Mapped[List["Dialogue"]] = relationship("Dialogue", back_populates="client")
    addresses: Mapped[List["ClientAddress"]] = relationship(
        "ClientAddress",
        back_populates="client",
        cascade="all, delete-orphan",
    )


class ClientAddress(Base):
    __tablename__ = "client_addresses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clients.id"), nullable=False, index=True)
    full_address: Mapped[str] = mapped_column(String(500), nullable=False)
    comment: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    lon: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    client: Mapped["Client"] = relationship("Client", back_populates="addresses")


class Driver(Base):
    __tablename__ = "drivers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"), nullable=True, unique=True)
    vehicle_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("vehicles.id"), nullable=True)
    status: Mapped[str] = mapped_column(
        SQLEnum("available", "busy", "offline", name="driver_status"),
        default="offline",
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_auto_dispatch_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    dispatch_priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    temporary_penalty_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_offer_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    moderation_status: Mapped[str] = mapped_column(
        SQLEnum(
            "incomplete",
            "pending_moderation",
            "approved",
            "rejected",
            "suspended",
            name="moderation_status",
        ),
        default="incomplete",
        nullable=False,
    )
    moderation_comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    moderated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    moderated_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"), nullable=True)
    fcm_token: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)

    user: Mapped[Optional["User"]] = relationship(
        "User",
        back_populates="driver_profile",
        foreign_keys=[user_id],
    )
    vehicle: Mapped[Optional["Vehicle"]] = relationship("Vehicle", back_populates="drivers")
    orders: Mapped[List["Order"]] = relationship("Order", back_populates="driver")
    offers: Mapped[List["OrderOffer"]] = relationship("OrderOffer", back_populates="driver")


class Vehicle(Base):
    __tablename__ = "vehicles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    brand: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    model: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    plate_number: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    vehicle_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    body_volume_m3: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cubature_min: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cubature_max: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    tonnage_min: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    tonnage_max: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    delivery_option_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("delivery_options.id"), nullable=True)
    rate_mode: Mapped[Optional[str]] = mapped_column(
        SQLEnum("per_ton_km", "fixed", name="vehicle_rate_mode"),
        nullable=True,
    )
    rate_per_ton_km: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    fixed_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    moderation_status: Mapped[str] = mapped_column(
        SQLEnum(
            "incomplete",
            "pending_moderation",
            "approved",
            "rejected",
            "suspended",
            name="moderation_status",
        ),
        default="incomplete",
        nullable=False,
    )
    moderation_comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    moderated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    moderated_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    delivery_option: Mapped[Optional["DeliveryOption"]] = relationship("DeliveryOption", back_populates="vehicles")
    drivers: Mapped[List["Driver"]] = relationship("Driver", back_populates="vehicle")


class Product(Base):
    __tablename__ = "products"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    price: Mapped[float] = mapped_column(Float, nullable=False)
    unit_type: Mapped[str] = mapped_column(String(50), nullable=False)
    image_url: Mapped[str] = mapped_column(String(500), nullable=False)


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    materials: Mapped[List["Material"]] = relationship(
        "Material", back_populates="category", cascade="all, delete-orphan"
    )


class Material(Base):
    __tablename__ = "materials"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    category_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("categories.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    unit: Mapped[str] = mapped_column(String(50), nullable=False)
    min_volume: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    image_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    category: Mapped[Optional["Category"]] = relationship("Category", back_populates="materials")
    quarry_links: Mapped[List["QuarryMaterial"]] = relationship(
        "QuarryMaterial",
        back_populates="material",
        cascade="all, delete-orphan",
        overlaps="materials,quarries",
    )
    quarries: Mapped[List["Quarry"]] = relationship(
        "Quarry",
        secondary=quarry_materials,
        back_populates="materials",
        overlaps="quarry_links,material_links,material,quarry",
    )
    cart_items: Mapped[List["CartItem"]] = relationship("CartItem", back_populates="material")


class PickupPointType(str, Enum):
    quarry = "quarry"
    accumulator = "accumulator"
    warehouse = "warehouse"
    supplier = "supplier"


class Quarry(Base):
    __tablename__ = "quarries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    short_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    point_type: Mapped[str] = mapped_column(
        SQLEnum(
            "quarry",
            "accumulator",
            "warehouse",
            "supplier",
            name="pickup_point_type",
        ),
        default=PickupPointType.quarry.value,
        nullable=False,
    )
    address: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    contact_phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lon: Mapped[float] = mapped_column(Float, nullable=False)
    min_delivery_price: Mapped[Optional[float]] = mapped_column(Numeric(12, 2), nullable=True)
    rating: Mapped[float] = mapped_column(Float, default=5.0, server_default="5.0", nullable=False)
    subscription_end_date: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
    )
    owner_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    moderation_status: Mapped[str] = mapped_column(
        SQLEnum(
            "incomplete",
            "pending_moderation",
            "approved",
            "rejected",
            "suspended",
            name="moderation_status",
        ),
        default="incomplete",
        nullable=False,
    )
    moderation_comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    moderated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    moderated_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    material_links: Mapped[List["QuarryMaterial"]] = relationship(
        "QuarryMaterial",
        back_populates="quarry",
        cascade="all, delete-orphan",
        overlaps="materials,quarries",
    )
    materials: Mapped[List["Material"]] = relationship(
        "Material",
        secondary=quarry_materials,
        back_populates="quarries",
        overlaps="material_links,quarry_links,material,quarry",
    )
    delivery_options: Mapped[List["DeliveryOption"]] = relationship(
        "DeliveryOption",
        secondary=quarry_delivery_options,
        back_populates="quarries",
    )
    owner: Mapped[Optional["User"]] = relationship(
        "User", back_populates="pickup_points", foreign_keys=[owner_user_id]
    )
    moderated_by: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[moderated_by_user_id]
    )
    orders: Mapped[List["Order"]] = relationship("Order", back_populates="quarry")


class QuarryMaterial(Base):
    __table__ = quarry_materials

    quarry: Mapped["Quarry"] = relationship(
        "Quarry",
        back_populates="material_links",
        overlaps="materials,quarries",
    )
    material: Mapped["Material"] = relationship(
        "Material",
        back_populates="quarry_links",
        overlaps="materials,quarries",
    )


class CartItem(Base):
    __tablename__ = "cart_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_key: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    material_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("materials.id"))
    quarry_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("quarries.id"), nullable=True
    )
    volume: Mapped[float] = mapped_column(Float, nullable=False)
    unit_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    material: Mapped["Material"] = relationship("Material", back_populates="cart_items")
    quarry: Mapped[Optional["Quarry"]] = relationship("Quarry")

    @property
    def pickup_point_name(self) -> str | None:
        return self.quarry.name if self.quarry is not None else None

    @property
    def pickup_point_type(self) -> str | None:
        return self.quarry.point_type if self.quarry is not None else None


class DeliveryOption(Base):
    __tablename__ = "delivery_options"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    capacity_m3: Mapped[float] = mapped_column(Float, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    base_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    delivery_rate_per_km: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    min_price_quarry: Mapped[float] = mapped_column(
        Float, default=5000.0, server_default="5000", nullable=False
    )
    min_price_warehouse: Mapped[float] = mapped_column(
        Float, default=3000.0, server_default="3000", nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    image_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    orders: Mapped[List["Order"]] = relationship("Order", back_populates="delivery_option")
    vehicles: Mapped[List["Vehicle"]] = relationship("Vehicle", back_populates="delivery_option")
    quarries: Mapped[List["Quarry"]] = relationship(
        "Quarry",
        secondary=quarry_delivery_options,
        back_populates="delivery_options",
    )


class MediaFile(Base):
    __tablename__ = "media_files"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    bucket: Mapped[str] = mapped_column(String(255), nullable=False)
    object_key: Mapped[str] = mapped_column(String(1024), nullable=False, unique=True)
    public_url: Mapped[str] = mapped_column(String(1024), nullable=False)
    content_type: Mapped[str] = mapped_column(String(255), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    slot_key: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SpecialEquipmentType(Base):
    __tablename__ = "special_equipment_types"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    listings: Mapped[List["SpecialEquipmentListing"]] = relationship(
        "SpecialEquipmentListing", back_populates="equipment_type"
    )


class SpecialEquipmentListing(Base):
    __tablename__ = "special_equipment_listings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    equipment_type_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("special_equipment_types.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    tariffs: Mapped[list[dict]] = mapped_column(
        JSONB, default=list, nullable=False, server_default="[]"
    )
    city: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    district: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    is_deleted: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        index=True,
        server_default=text("false"),
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    equipment_type: Mapped["SpecialEquipmentType"] = relationship(
        "SpecialEquipmentType", back_populates="listings"
    )
    created_by: Mapped["User"] = relationship("User", foreign_keys=[created_by_user_id])
    applications: Mapped[List["SpecialEquipmentApplication"]] = relationship(
        "SpecialEquipmentApplication", back_populates="listing"
    )


class SpecialEquipmentApplication(Base):
    __tablename__ = "special_equipment_applications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    listing_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("special_equipment_listings.id"), nullable=False, index=True
    )
    client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clients.id"), nullable=False, index=True)
    listing_title_snapshot: Mapped[str] = mapped_column(String(255), nullable=False)
    contact_phone: Mapped[str] = mapped_column(String(20), nullable=False)
    object_address: Mapped[str] = mapped_column(String(1000), nullable=False)
    requested_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    requested_time: Mapped[time] = mapped_column(Time, nullable=False)
    duration_value: Mapped[float] = mapped_column(Float, nullable=False)
    duration_unit: Mapped[str] = mapped_column(String(20), nullable=False)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    total_price: Mapped[Optional[float]] = mapped_column(Numeric(12, 2), nullable=True)
    reject_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cancel_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="new", nullable=False, index=True)
    processed_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("duration_value > 0", name="ck_special_equipment_application_duration"),
        CheckConstraint(
            "duration_unit IN ('hours', 'shifts')",
            name="ck_special_equipment_application_duration_unit",
        ),
        CheckConstraint(
            "status IN ('new', 'in_progress', 'closed', 'completed', 'rejected', 'cancelled')",
            name="ck_special_equipment_application_status",
        ),
        CheckConstraint(
            "status <> 'rejected' OR (reject_reason IS NOT NULL AND btrim(reject_reason) <> '')",
            name="ck_special_equipment_application_reject_reason",
        ),
        CheckConstraint(
            "status <> 'cancelled' OR (cancel_reason IS NOT NULL AND btrim(cancel_reason) <> '')",
            name="ck_special_equipment_application_cancel_reason",
        ),
    )

    listing: Mapped["SpecialEquipmentListing"] = relationship(
        "SpecialEquipmentListing", back_populates="applications"
    )
    client: Mapped["Client"] = relationship("Client")
    processed_by: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[processed_by_user_id]
    )


class SupportTicket(Base):
    __tablename__ = "support_tickets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("clients.id"), nullable=True, index=True
    )
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(String(50), default="general", nullable=False, index=True)
    context_type: Mapped[str] = mapped_column(String(50), default="general", nullable=False)
    context_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="new", nullable=False, index=True)
    assigned_to_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "(client_id IS NOT NULL AND user_id IS NULL) OR "
            "(client_id IS NULL AND user_id IS NOT NULL)",
            name="ck_support_ticket_single_author",
        ),
        CheckConstraint(
            "status IN ('new', 'in_progress', 'closed')",
            name="ck_support_ticket_status",
        ),
        CheckConstraint(
            "context_type IN ('general', 'order', 'pickup_point', 'equipment_listing', 'user')",
            name="ck_support_ticket_context_type",
        ),
    )

    client: Mapped[Optional["Client"]] = relationship("Client", foreign_keys=[client_id])
    user: Mapped[Optional["User"]] = relationship("User", foreign_keys=[user_id])
    assigned_to: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[assigned_to_user_id]
    )
    messages: Mapped[List["SupportMessage"]] = relationship(
        "SupportMessage", back_populates="ticket", cascade="all, delete-orphan"
    )


class SupportMessage(Base):
    __tablename__ = "support_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ticket_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("support_tickets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_client_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("clients.id"), nullable=True
    )
    author_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    attachment_url: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint(
            "(author_client_id IS NOT NULL AND author_user_id IS NULL) OR "
            "(author_client_id IS NULL AND author_user_id IS NOT NULL)",
            name="ck_support_message_single_author",
        ),
    )

    ticket: Mapped["SupportTicket"] = relationship("SupportTicket", back_populates="messages")
    author_client: Mapped[Optional["Client"]] = relationship(
        "Client", foreign_keys=[author_client_id]
    )
    author_user: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[author_user_id]
    )


class OrderStatus(str, Enum):
    draft = "draft"
    created = "created"
    searching_driver = "searching_driver"
    offered_to_driver = "offered_to_driver"
    driver_assigned = "driver_assigned"
    driver_accepted = "driver_accepted"
    heading_to_pickup = "heading_to_pickup"
    arrived_at_pickup = "arrived_at_pickup"
    loading = "loading"
    heading_to_client = "heading_to_client"
    delivered = "delivered"
    timeout = "timeout"
    completed = "completed"
    cancelled = "cancelled"
    no_driver_found = "no_driver_found"


class DriverStatus(str, Enum):
    available = "available"
    busy = "busy"
    offline = "offline"


class ModerationStatus(str, Enum):
    incomplete = "incomplete"
    pending_moderation = "pending_moderation"
    approved = "approved"
    rejected = "rejected"
    suspended = "suspended"


class VehicleRateMode(str, Enum):
    per_ton_km = "per_ton_km"
    fixed = "fixed"


class OrderOfferStatus(str, Enum):
    pending = "pending"
    accepted = "accepted"
    declined = "declined"
    expired = "expired"
    cancelled = "cancelled"


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clients.id"))
    driver_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("drivers.id"), nullable=True)
    delivery_option_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("delivery_options.id"), nullable=True
    )
    quarry_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("quarries.id"), nullable=True)
    current_offer_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("order_offers.id"), nullable=True)
    address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    pickup_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    pickup_lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pickup_lon: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    delivery_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    delivery_lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    delivery_lon: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    mileage_km: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    delivery_rate_per_km_snapshot: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    delivery_cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    calculation_source: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    route_calculated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    total_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[str] = mapped_column(String(50), default=OrderStatus.draft.value)
    source: Mapped[Optional[str]] = mapped_column(String(50), default="avito", nullable=True)
    created_by_source: Mapped[Optional[str]] = mapped_column(String(50), default="client_app", nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_dialogue_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("dialogues.id"), nullable=True
    )
    dispatch_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    assigned_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    client: Mapped["Client"] = relationship("Client", back_populates="orders")
    driver: Mapped[Optional["Driver"]] = relationship("Driver", back_populates="orders")
    delivery_option: Mapped[Optional["DeliveryOption"]] = relationship(
        "DeliveryOption", back_populates="orders"
    )
    quarry: Mapped[Optional["Quarry"]] = relationship("Quarry", back_populates="orders")
    items: Mapped[List["OrderItem"]] = relationship(
        "OrderItem", back_populates="order", cascade="all, delete-orphan"
    )
    order_events: Mapped[List["OrderEvent"]] = relationship(
        "OrderEvent", back_populates="order", cascade="all, delete-orphan"
    )
    events: Mapped[List["EventLog"]] = relationship("EventLog", back_populates="order")
    offers: Mapped[List["OrderOffer"]] = relationship(
        "OrderOffer",
        back_populates="order",
        foreign_keys="OrderOffer.order_id",
    )
    current_offer: Mapped[Optional["OrderOffer"]] = relationship(
        "OrderOffer", foreign_keys=[current_offer_id], post_update=True
    )
    dialogues: Mapped[List["Dialogue"]] = relationship(
        "Dialogue",
        back_populates="order",
        foreign_keys="Dialogue.order_id",
    )
    source_dialogue: Mapped[Optional["Dialogue"]] = relationship(
        "Dialogue", foreign_keys=[source_dialogue_id]
    )

    @property
    def quantity(self) -> int:
        return sum(item.quantity for item in self.items)

    @property
    def client_phone(self) -> str | None:
        return self.client.phone if self.client is not None else None

    @property
    def client_name(self) -> str | None:
        return self.client.name if self.client is not None else None

    @property
    def quarry_name(self) -> str | None:
        return self.quarry.name if self.quarry is not None else None

    @property
    def pickup_point_type(self) -> str | None:
        return self.quarry.point_type if self.quarry is not None else None


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id"))
    material_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("materials.id"))
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    volume: Mapped[float] = mapped_column(Float, nullable=False)
    price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    order: Mapped["Order"] = relationship("Order", back_populates="items")
    material: Mapped["Material"] = relationship("Material")


class OrderEvent(Base):
    __tablename__ = "order_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    order: Mapped["Order"] = relationship("Order", back_populates="order_events")


class EventLog(Base):
    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("orders.id"), nullable=True)
    event_type: Mapped[str] = mapped_column(String(100))
    description: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    order: Mapped[Optional["Order"]] = relationship("Order", back_populates="events")


class ErrorLog(Base):
    __tablename__ = "error_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    error_code: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class OrderOffer(Base):
    __tablename__ = "order_offers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id"))
    driver_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("drivers.id"))
    price: Mapped[float] = mapped_column(Float, default=0.0)
    sequence_no: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    status: Mapped[str] = mapped_column(String(50), default=OrderOfferStatus.pending.value, nullable=False)
    offered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    responded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    priority_snapshot: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    order: Mapped["Order"] = relationship("Order", back_populates="offers", foreign_keys=[order_id])
    driver: Mapped["Driver"] = relationship("Driver", back_populates="offers")


class IntegrationEvent(Base):
    __tablename__ = "integration_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source: Mapped[str] = mapped_column(String(50))
    external_event_id: Mapped[str] = mapped_column(String(255))
    payload: Mapped[dict] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(50))
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("source", "external_event_id", name="uix_integration_events_source_external_id"),
    )


class Channel(Base):
    __tablename__ = "channels"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(50))
    external_account_id: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    __table_args__ = (
        UniqueConstraint("name", "external_account_id", name="uix_channels_name_external_id"),
    )

    dialogues: Mapped[List["Dialogue"]] = relationship(
        "Dialogue", back_populates="channel", cascade="all, delete-orphan"
    )


class Dialogue(Base):
    __tablename__ = "dialogues"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    channel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("channels.id"))
    external_dialog_id: Mapped[str] = mapped_column(String(255))
    client_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("clients.id"), nullable=True)
    order_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("orders.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(50))
    last_message_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("channel_id", "external_dialog_id", name="uix_dialogues_channel_external_id"),
    )

    channel: Mapped["Channel"] = relationship("Channel", back_populates="dialogues")
    client: Mapped[Optional["Client"]] = relationship("Client", back_populates="dialogues")
    order: Mapped[Optional["Order"]] = relationship(
        "Order",
        back_populates="dialogues",
        foreign_keys=[order_id],
    )
    messages: Mapped[List["Message"]] = relationship(
        "Message", back_populates="dialogue", cascade="all, delete-orphan"
    )
    ai_analyses: Mapped[List["MessageAiAnalysis"]] = relationship(
        "MessageAiAnalysis", back_populates="dialogue", cascade="all, delete-orphan"
    )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dialogue_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("dialogues.id"))
    external_message_id: Mapped[str] = mapped_column(String(255))
    direction: Mapped[str] = mapped_column(String(50))
    message_type: Mapped[str] = mapped_column(String(50))
    text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    raw_payload: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("dialogue_id", "external_message_id", name="uix_messages_dialogue_external_id"),
    )

    dialogue: Mapped["Dialogue"] = relationship("Dialogue", back_populates="messages")
    ai_analyses: Mapped[List["MessageAiAnalysis"]] = relationship(
        "MessageAiAnalysis", back_populates="message", cascade="all, delete-orphan"
    )


class MessageAiAnalysis(Base):
    __tablename__ = "message_ai_analyses"

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

    message: Mapped["Message"] = relationship("Message", back_populates="ai_analyses")
    dialogue: Mapped["Dialogue"] = relationship("Dialogue", back_populates="ai_analyses")
