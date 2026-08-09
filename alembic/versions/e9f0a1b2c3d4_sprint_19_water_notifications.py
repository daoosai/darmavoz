"""Sprint 19 water, notifications, account lifecycle.

Revision ID: e9f0a1b2c3d4
Revises: d3e4f5a6b7c8
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e9f0a1b2c3d4"
down_revision: Union[str, None] = "d3e4f5a6b7c8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    water_type = postgresql.ENUM("free", "paid", name="water_point_type")
    water_type.create(op.get_bind(), checkfirst=True)
    op.add_column("users", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("deletion_source", sa.String(20), nullable=True))
    op.add_column("users", sa.Column("auth_version", sa.Integer(), server_default="1", nullable=False))
    op.add_column("clients", sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False))
    op.add_column("clients", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("clients", sa.Column("deletion_source", sa.String(20), nullable=True))
    op.add_column("clients", sa.Column("auth_version", sa.Integer(), server_default="1", nullable=False))
    op.create_index("ix_clients_is_deleted", "clients", ["is_deleted"])
    for column in (
        sa.Column("clarification_reasons", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("clarification_comment", sa.Text(), nullable=True),
        sa.Column("clarification_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("clarification_resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("clarification_resolved_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("clarification_resume_status", sa.String(50), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_by_type", sa.String(20), nullable=True),
        sa.Column("cancel_reason", sa.Text(), nullable=True),
    ):
        op.add_column("orders", column)
    op.create_foreign_key("fk_orders_clarification_resolved_by", "orders", "users", ["clarification_resolved_by_user_id"], ["id"])
    op.create_index("ix_orders_client_status_created", "orders", ["client_id", "status", "created_at"])
    op.create_index("ix_orders_status_created", "orders", ["status", "created_at"])
    op.create_table("water_points",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("water_type", water_type, nullable=False), sa.Column("name", sa.String(255)),
        sa.Column("source", sa.String(255), nullable=False), sa.Column("address", sa.Text(), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False), sa.Column("lon", sa.Float(), nullable=False),
        sa.Column("phone", sa.String(20)), sa.Column("price", sa.Numeric(12, 2)), sa.Column("price_unit", sa.String(50)), sa.Column("description", sa.Text()),
        sa.Column("moderation_status", sa.String(32), nullable=False, server_default="pending_moderation"), sa.Column("moderation_comment", sa.Text()), sa.Column("pending_changes", postgresql.JSONB()),
        sa.Column("moderated_at", sa.DateTime(timezone=True)), sa.Column("moderated_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")), sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()), sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("lat >= -90 AND lat <= 90 AND lon >= -180 AND lon <= 180", name="ck_water_point_coordinates"),
        sa.CheckConstraint("water_type <> 'paid' OR (name IS NOT NULL AND btrim(name) <> '' AND phone IS NOT NULL AND btrim(phone) <> '' AND price > 0 AND price_unit IS NOT NULL AND btrim(price_unit) <> '' AND description IS NOT NULL AND btrim(description) <> '')", name="ck_paid_water_required"),
        sa.CheckConstraint("water_type <> 'free' OR (price IS NULL AND price_unit IS NULL)", name="ck_free_water_no_price"),
    )
    op.create_index("ix_water_points_owner_created", "water_points", ["owner_user_id", "created_at"])
    op.create_index("ix_water_points_public", "water_points", ["moderation_status", "is_active", "is_deleted"])
    op.create_table("septic_provider_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True), sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False, unique=True),
        sa.Column("phone", sa.String(20), nullable=False), sa.Column("address", sa.Text(), nullable=False), sa.Column("lat", sa.Float(), nullable=False), sa.Column("lon", sa.Float(), nullable=False),
        sa.Column("tank_volume_m3", sa.Numeric(8, 2), nullable=False), sa.Column("service_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("moderation_status", sa.String(32), nullable=False, server_default="pending_moderation"), sa.Column("moderation_comment", sa.Text()), sa.Column("pending_changes", postgresql.JSONB()),
        sa.Column("moderated_at", sa.DateTime(timezone=True)), sa.Column("moderated_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")), sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()), sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("lat >= -90 AND lat <= 90 AND lon >= -180 AND lon <= 180", name="ck_septic_coordinates"), sa.CheckConstraint("tank_volume_m3 > 0", name="ck_septic_tank_volume"), sa.CheckConstraint("service_price > 0", name="ck_septic_service_price"),
    )
    op.create_index("ix_septic_profiles_public", "septic_provider_profiles", ["moderation_status", "is_active", "is_deleted"])
    op.create_table("user_notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True), sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("event_type", sa.String(64), nullable=False), sa.Column("title", sa.String(255), nullable=False), sa.Column("body", sa.Text(), nullable=False), sa.Column("payload", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.text("false")), sa.Column("read_at", sa.DateTime(timezone=True)), sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_user_notifications_unread_created", "user_notifications", ["user_id", "is_read", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_user_notifications_unread_created", table_name="user_notifications"); op.drop_table("user_notifications")
    op.drop_index("ix_septic_profiles_public", table_name="septic_provider_profiles"); op.drop_table("septic_provider_profiles")
    op.drop_index("ix_water_points_public", table_name="water_points"); op.drop_index("ix_water_points_owner_created", table_name="water_points"); op.drop_table("water_points")
    op.drop_index("ix_orders_status_created", table_name="orders"); op.drop_index("ix_orders_client_status_created", table_name="orders"); op.drop_constraint("fk_orders_clarification_resolved_by", "orders", type_="foreignkey")
    for name in ("cancel_reason", "cancelled_by_type", "cancelled_at", "clarification_resume_status", "clarification_resolved_by_user_id", "clarification_resolved_at", "clarification_requested_at", "clarification_comment", "clarification_reasons"): op.drop_column("orders", name)
    op.drop_index("ix_clients_is_deleted", table_name="clients")
    for name in ("auth_version", "deletion_source", "deleted_at", "is_deleted"): op.drop_column("clients", name)
    for name in ("auth_version", "deletion_source", "deleted_at"): op.drop_column("users", name)
    postgresql.ENUM(name="water_point_type").drop(op.get_bind(), checkfirst=True)
