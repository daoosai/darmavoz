"""Sprint 15 equipment marketplace and support desk.

Revision ID: e15a2b3c4d5f
Revises: d4e5f6a7b8c9
"""

from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "e15a2b3c4d5f"
down_revision: Union[str, None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    equipment_types = op.create_table(
        "special_equipment_types",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("slug", sa.String(length=255), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index("ix_special_equipment_types_slug", "special_equipment_types", ["slug"])

    op.create_table(
        "special_equipment_listings",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("equipment_type_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("price_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("price_unit", sa.String(length=20), nullable=False),
        sa.Column("city", sa.String(length=255), nullable=True),
        sa.Column("district", sa.String(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "price_unit IN ('hour', 'shift', 'day', 'negotiable')",
            name="ck_special_equipment_price_unit",
        ),
        sa.CheckConstraint(
            "(price_unit = 'negotiable' AND price_amount IS NULL) OR "
            "(price_unit <> 'negotiable' AND price_amount IS NOT NULL AND price_amount > 0)",
            name="ck_special_equipment_price",
        ),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["equipment_type_id"], ["special_equipment_types.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_special_equipment_listings_type", "special_equipment_listings", ["equipment_type_id"])
    op.create_index("ix_special_equipment_listings_active", "special_equipment_listings", ["is_active"])
    op.create_index("ix_special_equipment_listings_city", "special_equipment_listings", ["city"])
    op.create_index("ix_special_equipment_listings_district", "special_equipment_listings", ["district"])

    op.create_table(
        "special_equipment_applications",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("listing_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("listing_title_snapshot", sa.String(length=255), nullable=False),
        sa.Column("contact_phone", sa.String(length=20), nullable=False),
        sa.Column("object_address", sa.String(length=1000), nullable=False),
        sa.Column("requested_date", sa.Date(), nullable=False),
        sa.Column("requested_time", sa.Time(), nullable=False),
        sa.Column("duration_value", sa.Float(), nullable=False),
        sa.Column("duration_unit", sa.String(length=20), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="new", nullable=False),
        sa.Column("processed_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("duration_value > 0", name="ck_special_equipment_application_duration"),
        sa.CheckConstraint("duration_unit IN ('hours', 'shifts')", name="ck_special_equipment_application_duration_unit"),
        sa.CheckConstraint("status IN ('new', 'in_progress', 'closed')", name="ck_special_equipment_application_status"),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"]),
        sa.ForeignKeyConstraint(["listing_id"], ["special_equipment_listings.id"]),
        sa.ForeignKeyConstraint(["processed_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_special_equipment_applications_listing", "special_equipment_applications", ["listing_id"])
    op.create_index("ix_special_equipment_applications_client", "special_equipment_applications", ["client_id"])
    op.create_index("ix_special_equipment_applications_date", "special_equipment_applications", ["requested_date"])
    op.create_index("ix_special_equipment_applications_status", "special_equipment_applications", ["status"])

    op.create_table(
        "support_tickets",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("category", sa.String(length=50), server_default="general", nullable=False),
        sa.Column("context_type", sa.String(length=50), server_default="general", nullable=False),
        sa.Column("context_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="new", nullable=False),
        sa.Column("assigned_to_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "(client_id IS NOT NULL AND user_id IS NULL) OR (client_id IS NULL AND user_id IS NOT NULL)",
            name="ck_support_ticket_single_author",
        ),
        sa.CheckConstraint("status IN ('new', 'in_progress', 'closed')", name="ck_support_ticket_status"),
        sa.CheckConstraint(
            "context_type IN ('general', 'order', 'pickup_point', 'equipment_listing', 'user')",
            name="ck_support_ticket_context_type",
        ),
        sa.ForeignKeyConstraint(["assigned_to_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_support_tickets_client", "support_tickets", ["client_id"])
    op.create_index("ix_support_tickets_user", "support_tickets", ["user_id"])
    op.create_index("ix_support_tickets_status", "support_tickets", ["status"])
    op.create_index("ix_support_tickets_category", "support_tickets", ["category"])

    op.create_table(
        "support_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("ticket_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("author_client_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("author_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "(author_client_id IS NOT NULL AND author_user_id IS NULL) OR "
            "(author_client_id IS NULL AND author_user_id IS NOT NULL)",
            name="ck_support_message_single_author",
        ),
        sa.ForeignKeyConstraint(["author_client_id"], ["clients.id"]),
        sa.ForeignKeyConstraint(["author_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["ticket_id"], ["support_tickets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_support_messages_ticket", "support_messages", ["ticket_id"])

    op.bulk_insert(
        equipment_types,
        [
            {"id": uuid.UUID("15000000-0000-0000-0000-000000000001"), "name": "Экскаватор", "slug": "excavator", "sort_order": 10, "is_active": True},
            {"id": uuid.UUID("15000000-0000-0000-0000-000000000002"), "name": "Мини-экскаватор", "slug": "mini-excavator", "sort_order": 20, "is_active": True},
            {"id": uuid.UUID("15000000-0000-0000-0000-000000000003"), "name": "Фронтальный погрузчик", "slug": "front-loader", "sort_order": 30, "is_active": True},
            {"id": uuid.UUID("15000000-0000-0000-0000-000000000004"), "name": "Трактор", "slug": "tractor", "sort_order": 40, "is_active": True},
            {"id": uuid.UUID("15000000-0000-0000-0000-000000000005"), "name": "Бурилка", "slug": "drilling-rig", "sort_order": 50, "is_active": True},
            {"id": uuid.UUID("15000000-0000-0000-0000-000000000006"), "name": "Манипулятор", "slug": "loader-crane", "sort_order": 60, "is_active": True},
            {"id": uuid.UUID("15000000-0000-0000-0000-000000000007"), "name": "Самосвал", "slug": "dump-truck", "sort_order": 70, "is_active": True},
        ],
    )


def downgrade() -> None:
    op.drop_index("ix_support_messages_ticket", table_name="support_messages")
    op.drop_table("support_messages")
    op.drop_index("ix_support_tickets_category", table_name="support_tickets")
    op.drop_index("ix_support_tickets_status", table_name="support_tickets")
    op.drop_index("ix_support_tickets_user", table_name="support_tickets")
    op.drop_index("ix_support_tickets_client", table_name="support_tickets")
    op.drop_table("support_tickets")
    op.drop_index("ix_special_equipment_applications_status", table_name="special_equipment_applications")
    op.drop_index("ix_special_equipment_applications_date", table_name="special_equipment_applications")
    op.drop_index("ix_special_equipment_applications_client", table_name="special_equipment_applications")
    op.drop_index("ix_special_equipment_applications_listing", table_name="special_equipment_applications")
    op.drop_table("special_equipment_applications")
    op.drop_index("ix_special_equipment_listings_district", table_name="special_equipment_listings")
    op.drop_index("ix_special_equipment_listings_city", table_name="special_equipment_listings")
    op.drop_index("ix_special_equipment_listings_active", table_name="special_equipment_listings")
    op.drop_index("ix_special_equipment_listings_type", table_name="special_equipment_listings")
    op.drop_table("special_equipment_listings")
    op.drop_index("ix_special_equipment_types_slug", table_name="special_equipment_types")
    op.drop_table("special_equipment_types")
