"""Sprint 18 placement lifecycle and relevance.

Revision ID: d3e4f5a6b7c8
Revises: b1c2d3e4f5a6
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from app.core.config import settings


revision: str = "d3e4f5a6b7c8"
down_revision: Union[str, None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


PLACEMENT_VALUES = (
    "active",
    "pending_moderation",
    "hidden",
    "archived",
    "confirmation_required",
    "trial",
    "expired",
)


def _add_placement_columns(table_name: str, placement_enum: postgresql.ENUM) -> None:
    op.add_column(table_name, sa.Column("placement_status", placement_enum, nullable=True))
    op.add_column(table_name, sa.Column("placement_started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(table_name, sa.Column("trial_ends_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(table_name, sa.Column("placement_ends_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(table_name, sa.Column("last_confirmed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(table_name, sa.Column("next_confirmation_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(table_name, sa.Column("placement_status_changed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(table_name, sa.Column("placement_hidden_reason", sa.String(length=64), nullable=True))
    op.add_column(table_name, sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))


def _create_placement_indexes(table_name: str, prefix: str) -> None:
    op.create_index(f"ix_{table_name}_placement_status", table_name, ["placement_status"])
    op.create_index(f"ix_{table_name}_archived_at", table_name, ["archived_at"])
    op.create_index(
        f"ix_{prefix}_placement_status_ends",
        table_name,
        ["placement_status", "placement_ends_at"],
    )
    op.create_index(
        f"ix_{prefix}_placement_status_confirmation",
        table_name,
        ["placement_status", "next_confirmation_at"],
    )


def upgrade() -> None:
    connection = op.get_bind()
    placement_enum = postgresql.ENUM(
        *PLACEMENT_VALUES,
        name="placement_status",
        create_type=False,
    )
    placement_enum.create(connection, checkfirst=True)

    _add_placement_columns("quarries", placement_enum)
    _add_placement_columns("special_equipment_listings", placement_enum)

    op.create_table(
        "placement_audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("entity_type", sa.String(length=32), nullable=False),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("old_status", sa.String(length=32), nullable=True),
        sa.Column("new_status", sa.String(length=32), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_placement_audit_logs_actor_user_id", "placement_audit_logs", ["actor_user_id"])
    op.create_index(
        "ix_placement_audit_entity_created",
        "placement_audit_logs",
        ["entity_type", "entity_id", "created_at"],
    )

    confirmation_days = settings.PLACEMENT_CONFIRMATION_INTERVAL_DAYS
    connection.execute(
        sa.text(
            """
            UPDATE quarries
            SET placement_ends_at = subscription_end_date,
                placement_status = CASE
                    WHEN moderation_status::text NOT IN ('approved', 'has_pending_changes')
                        THEN 'pending_moderation'::placement_status
                    WHEN is_active IS FALSE THEN 'hidden'::placement_status
                    WHEN subscription_end_date IS NOT NULL AND subscription_end_date <= now()
                        THEN 'expired'::placement_status
                    ELSE 'active'::placement_status
                END,
                placement_started_at = COALESCE(moderated_at, created_at, now()),
                last_confirmed_at = CASE
                    WHEN is_active IS TRUE
                     AND moderation_status::text IN ('approved', 'has_pending_changes')
                     AND (subscription_end_date IS NULL OR subscription_end_date > now())
                    THEN now() ELSE NULL
                END,
                next_confirmation_at = CASE
                    WHEN is_active IS TRUE
                     AND moderation_status::text IN ('approved', 'has_pending_changes')
                     AND (subscription_end_date IS NULL OR subscription_end_date > now())
                    THEN now() + make_interval(days => :confirmation_days) ELSE NULL
                END,
                placement_hidden_reason = CASE WHEN is_active IS FALSE THEN 'manual' ELSE NULL END,
                placement_status_changed_at = now()
            """
        ),
        {"confirmation_days": confirmation_days},
    )
    connection.execute(
        sa.text(
            """
            UPDATE special_equipment_listings
            SET placement_status = CASE
                    WHEN is_deleted IS TRUE THEN 'archived'::placement_status
                    WHEN moderation_status::text NOT IN ('approved', 'has_pending_changes')
                        THEN 'pending_moderation'::placement_status
                    WHEN is_active IS FALSE THEN 'hidden'::placement_status
                    ELSE 'active'::placement_status
                END,
                placement_started_at = COALESCE(moderated_at, created_at, now()),
                last_confirmed_at = CASE
                    WHEN is_deleted IS FALSE
                     AND is_active IS TRUE
                     AND moderation_status::text IN ('approved', 'has_pending_changes')
                    THEN now() ELSE NULL
                END,
                next_confirmation_at = CASE
                    WHEN is_deleted IS FALSE
                     AND is_active IS TRUE
                     AND moderation_status::text IN ('approved', 'has_pending_changes')
                    THEN now() + make_interval(days => :confirmation_days) ELSE NULL
                END,
                placement_hidden_reason = CASE WHEN is_active IS FALSE THEN 'manual' ELSE NULL END,
                archived_at = CASE WHEN is_deleted IS TRUE THEN now() ELSE NULL END,
                placement_status_changed_at = now()
            """
        ),
        {"confirmation_days": confirmation_days},
    )

    connection.execute(
        sa.text(
            """
            UPDATE quarries
            SET is_active = placement_status IN ('active', 'trial', 'confirmation_required')
            """
        )
    )
    connection.execute(
        sa.text(
            """
            UPDATE special_equipment_listings
            SET is_active = placement_status IN ('active', 'trial', 'confirmation_required')
            """
        )
    )

    for table_name in ("quarries", "special_equipment_listings"):
        op.alter_column(
            table_name,
            "placement_status",
            existing_type=placement_enum,
            nullable=False,
            server_default="pending_moderation",
        )

    _create_placement_indexes("quarries", "quarries")
    _create_placement_indexes("special_equipment_listings", "special_equipment")


def downgrade() -> None:
    for table_name, prefix in (
        ("special_equipment_listings", "special_equipment"),
        ("quarries", "quarries"),
    ):
        op.drop_index(f"ix_{prefix}_placement_status_confirmation", table_name=table_name)
        op.drop_index(f"ix_{prefix}_placement_status_ends", table_name=table_name)
        op.drop_index(f"ix_{table_name}_archived_at", table_name=table_name)
        op.drop_index(f"ix_{table_name}_placement_status", table_name=table_name)
        for column_name in (
            "archived_at",
            "placement_hidden_reason",
            "placement_status_changed_at",
            "next_confirmation_at",
            "last_confirmed_at",
            "placement_ends_at",
            "trial_ends_at",
            "placement_started_at",
            "placement_status",
        ):
            op.drop_column(table_name, column_name)

    op.drop_index("ix_placement_audit_entity_created", table_name="placement_audit_logs")
    op.drop_index("ix_placement_audit_logs_actor_user_id", table_name="placement_audit_logs")
    op.drop_table("placement_audit_logs")
    postgresql.ENUM(*PLACEMENT_VALUES, name="placement_status").drop(op.get_bind(), checkfirst=True)
