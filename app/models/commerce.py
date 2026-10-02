"""Sprint 24: partner announcements and durable payment records."""
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.models import Base


class WholesaleRequest(Base):
    __tablename__ = "wholesale_requests"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    city_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("cities.id"), index=True)
    material_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("materials.id"), nullable=True)
    material_name: Mapped[str] = mapped_column(String(255))
    volume: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    unit: Mapped[str] = mapped_column(String(10))
    vehicle_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pickup_address: Mapped[str] = mapped_column(String(500))
    delivery_address: Mapped[str] = mapped_column(String(500))
    starts_on: Mapped[date] = mapped_column(Date)
    ends_on: Mapped[date] = mapped_column(Date, index=True)
    price: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    price_basis: Mapped[str] = mapped_column(String(20))
    contact_name: Mapped[str] = mapped_column(String(255))
    contact_phone: Mapped[str] = mapped_column(String(30))
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    reject_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    __table_args__ = (
        CheckConstraint("status IN ('draft', 'pending', 'approved', 'rejected', 'archived')", name="ck_wholesale_status"),
        CheckConstraint("status != 'rejected' OR length(trim(reject_reason)) > 0 AND reject_reason IS NOT NULL", name="ck_wholesale_reject_reason"),
        CheckConstraint("volume > 0 AND vehicle_count > 0 AND price > 0", name="ck_wholesale_positive"),
        CheckConstraint("ends_on >= starts_on", name="ck_wholesale_dates"),
    )


class WholesaleFavorite(Base):
    __tablename__ = "wholesale_favorites"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    request_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("wholesale_requests.id"), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class WholesaleEvent(Base):
    __tablename__ = "wholesale_events"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("wholesale_requests.id"), index=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(32))
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PaymentQuote(Base):
    __tablename__ = "payment_quotes"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    is_valid: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    items: Mapped[list] = mapped_column(JSONB)
    confirmed_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (UniqueConstraint("order_id", "version"), CheckConstraint("amount > 0", name="ck_quote_amount"))


class Payment(Base):
    __tablename__ = "payments"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id"), index=True)
    client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clients.id"), index=True)
    quote_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("payment_quotes.id"))
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3), default="RUB")
    provider_id: Mapped[str | None] = mapped_column(String(100), unique=True, nullable=True)
    idempotence_key: Mapped[str] = mapped_column(String(64), unique=True)
    status: Mapped[str] = mapped_column(String(32), default="creating", index=True)
    provider_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    payment_method: Mapped[str | None] = mapped_column(String(50), nullable=True)
    confirmation_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    receipt_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    refund_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    needs_review: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    failure_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_contact: Mapped[dict] = mapped_column(JSONB, default=dict)
    request_body: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reconciliation_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_payment_amount"),
        Index("uq_payment_order_active", "order_id", unique=True, postgresql_where=text("status IN ('creating', 'unknown', 'pending', 'succeeded')")),
    )


class PaymentEvent(Base):
    __tablename__ = "payment_events"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    payment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("payments.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Refund(Base):
    __tablename__ = "payment_refunds"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    payment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("payments.id"), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    provider_id: Mapped[str | None] = mapped_column(String(100), unique=True, nullable=True)
    idempotence_key: Mapped[str] = mapped_column(String(64), unique=True)
    initiated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reason: Mapped[str] = mapped_column(Text)
    request_body: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="creating")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    __table_args__ = (Index("uq_refund_active", "payment_id", unique=True, postgresql_where=text("status IN ('creating', 'unknown', 'pending', 'succeeded')")),)


class SettlementReceipt(Base):
    __tablename__ = "settlement_receipts"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    payment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("payments.id"), unique=True)
    idempotence_key: Mapped[str] = mapped_column(String(64), unique=True)
    provider_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="creating")
    request_body: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# Read-only projections keep every existing OrderOut endpoint on the same contract.
from sqlalchemy import select
from sqlalchemy.orm import column_property
from app.models.models import Order

Order.payment_status = column_property(select(Payment.status).where(Payment.order_id == Order.id).order_by(Payment.created_at.desc(), Payment.id).limit(1).correlate_except(Payment).scalar_subquery())
Order.confirmed_payment_amount = column_property(select(PaymentQuote.amount).where(PaymentQuote.order_id == Order.id, PaymentQuote.is_valid.is_(True)).order_by(PaymentQuote.version.desc()).limit(1).correlate_except(PaymentQuote).scalar_subquery())
Order.refund_status = column_property(select(Payment.refund_status).where(Payment.order_id == Order.id).order_by(Payment.created_at.desc(), Payment.id).limit(1).correlate_except(Payment).scalar_subquery())
