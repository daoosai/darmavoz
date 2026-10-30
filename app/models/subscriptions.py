"""Sprint 26 durable access, subscription billing, chat and journey ledgers.

Business roles stay unchanged. Grants retain their source; refunds cannot revoke
another payment, trial or legacy grant. Vehicle fingerprints survive re-registration.
"""
from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4
from sqlalchemy import Identity, String, Text, Boolean, DateTime, Integer, BigInteger, Numeric, ForeignKey, UniqueConstraint, CheckConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.models.models import Base

class Entity:
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

class SprintSetting(Base):
    __tablename__ = "s26_settings"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, default=dict)

class SubscriptionPlan(Entity, Base):
    __tablename__ = "subscription_plans"
    category: Mapped[str] = mapped_column(String(24), index=True)
    name: Mapped[str] = mapped_column(String(160))
    months: Mapped[int] = mapped_column(Integer)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(14,2), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    published: Mapped[bool] = mapped_column(Boolean, default=False)
    test_only: Mapped[bool] = mapped_column(Boolean, default=False)
    __table_args__ = (CheckConstraint("months IN (1,3,6,12)", name="ck_subscription_plan_months"), CheckConstraint("amount IS NULL OR amount > 0", name="ck_subscription_plan_amount"),)

class CategoryAccess(Entity, Base):
    __tablename__ = "category_access"
    account_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), index=True)
    category: Mapped[str] = mapped_column(String(24))
    trial_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    __table_args__ = (UniqueConstraint("account_id","category",name="uq_category_access"),)

class TrialIdentity(Base):
    __tablename__ = "trial_identities"
    category: Mapped[str] = mapped_column(String(24), primary_key=True)
    identity_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class AccessGrant(Entity, Base):
    __tablename__ = "access_grants"
    account_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    category: Mapped[str] = mapped_column(String(24), index=True)
    resource_type: Mapped[str | None] = mapped_column(String(24), nullable=True)
    resource_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True, index=True)
    source: Mapped[str] = mapped_column(String(24))
    source_key: Mapped[str] = mapped_column(String(160), unique=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    __table_args__ = (CheckConstraint("ends_at > starts_at", name="ck_access_grant_period"),)

class VehicleMembership(Base):
    __tablename__ = "vehicle_memberships"
    account_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    vehicle_id: Mapped[UUID] = mapped_column(ForeignKey("vehicles.id"), primary_key=True)

class VehicleTrial(Base):
    __tablename__ = "vehicle_trials"
    plate_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    vehicle_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class SubscriptionPayment(Entity, Base):
    __tablename__ = "subscription_payments"
    account_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), index=True)
    plan_id: Mapped[UUID] = mapped_column(ForeignKey("subscription_plans.id"))
    category: Mapped[str] = mapped_column(String(24))
    months: Mapped[int] = mapped_column(Integer)
    amount: Mapped[Decimal] = mapped_column(Numeric(14,2))
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    provider_id: Mapped[str | None] = mapped_column(String(120), unique=True, nullable=True)
    request_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), unique=True)
    idempotence_key: Mapped[str] = mapped_column(String(64), unique=True)
    body: Mapped[dict] = mapped_column(JSONB, default=dict)
    confirmation_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(160), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    __table_args__ = (CheckConstraint("amount > 0", name="ck_subscription_payment_amount"),)

class SubscriptionRefund(Entity, Base):
    __tablename__ = "subscription_refunds"
    payment_id: Mapped[UUID] = mapped_column(ForeignKey("subscription_payments.id"), index=True)
    actor_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(14,2))
    reason: Mapped[str] = mapped_column(String(500))
    request_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), unique=True)
    idempotence_key: Mapped[str] = mapped_column(String(64), unique=True)
    provider_id: Mapped[str | None] = mapped_column(String(120), unique=True, nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    access_adjustment: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    adjustment_applied: Mapped[bool] = mapped_column(Boolean, default=False)
    access_review_required: Mapped[bool] = mapped_column(Boolean, default=False)
    body: Mapped[dict] = mapped_column(JSONB, default=dict)
    last_error: Mapped[str | None] = mapped_column(String(160), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    __table_args__ = (CheckConstraint("amount > 0", name="ck_subscription_refund_amount"),)

class SubscriptionAudit(Entity, Base):
    __tablename__ = "subscription_audit"
    actor_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    account_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(80))
    details: Mapped[dict] = mapped_column(JSONB, default=dict)

class ChatMember(Base):
    __tablename__ = "chat_members"
    account_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    moderator: Mapped[bool] = mapped_column(Boolean, default=False)
    banned: Mapped[bool] = mapped_column(Boolean, default=False)
    removed: Mapped[bool] = mapped_column(Boolean, default=False)
    muted_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    account_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), index=True)
    request_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), unique=True)
    text: Mapped[str] = mapped_column(String(4000))
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

class ChatAudit(Entity, Base):
    __tablename__ = "chat_audit"
    sequence: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    actor_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    target_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    action: Mapped[str] = mapped_column(String(40))
    reason: Mapped[str] = mapped_column(String(500))
    details: Mapped[dict] = mapped_column(JSONB, default=dict)

class JourneySession(Base):
    __tablename__ = "journey_sessions"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    visitor_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), index=True)
    actor_type: Mapped[str | None] = mapped_column(String(12), nullable=True)
    actor_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True, index=True)
    city_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

class JourneyAttempt(Base):
    __tablename__ = "journey_attempts"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    session_id: Mapped[UUID] = mapped_column(ForeignKey("journey_sessions.id"), index=True)
    kind: Mapped[str] = mapped_column(String(24))
    stage: Mapped[str] = mapped_column(String(80))
    state: Mapped[str] = mapped_column(String(24), default="started")
    abandoned: Mapped[bool] = mapped_column(Boolean, default=False)
    contact_cipher: Mapped[str | None] = mapped_column(Text, nullable=True)
    contact_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    order_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    order_synced: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    payment_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    last_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

class JourneyEvent(Base):
    __tablename__ = "journey_events"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    session_id: Mapped[UUID] = mapped_column(ForeignKey("journey_sessions.id"), index=True)
    attempt_id: Mapped[UUID | None] = mapped_column(ForeignKey("journey_attempts.id"), nullable=True, index=True)
    event: Mapped[str] = mapped_column(String(80))
    source: Mapped[str] = mapped_column(String(12))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    details: Mapped[dict] = mapped_column(JSONB, default=dict)

class JourneyIncident(Entity, Base):
    __tablename__ = "journey_incidents"
    dedupe_key: Mapped[str] = mapped_column(String(180), unique=True)
    attempt_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    event: Mapped[str] = mapped_column(String(80))
    reason: Mapped[str] = mapped_column(String(200))
    count: Mapped[int] = mapped_column(Integer, default=1)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    notified: Mapped[bool] = mapped_column(Boolean, default=False)
    next_notify_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

class OrderReview(Base):
    __tablename__ = "order_reviews"
    order_id: Mapped[UUID] = mapped_column(ForeignKey("orders.id"), primary_key=True)
    client_id: Mapped[UUID] = mapped_column(ForeignKey("clients.id"))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    comment: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    __table_args__ = (CheckConstraint("rating IS NULL OR rating BETWEEN 1 AND 5", name="ck_order_review_rating"),)

# Preserve a stable plate fingerprint on every ORM registration/update path.
from sqlalchemy import event
from app.models.models import Vehicle
@event.listens_for(Vehicle, "before_insert")
@event.listens_for(Vehicle, "before_update")
def update_plate_fingerprint(mapper, connection, vehicle):
    from app.services.subscriptions import plate_key
    from fastapi import HTTPException
    try: vehicle.plate_key=plate_key(vehicle.plate_number)
    except HTTPException: vehicle.plate_key=None
