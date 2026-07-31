"""Sprint 17 lightweight moderation

Revision ID: a7c1d9e4f2b3
Revises: f9e8d7c6b5a4
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "a7c1d9e4f2b3"
down_revision: Union[str, None] = "f9e8d7c6b5a4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE moderation_status ADD VALUE IF NOT EXISTS 'has_pending_changes'")

    op.add_column(
        "quarries",
        sa.Column("pending_changes", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "special_equipment_listings",
        sa.Column("pending_changes", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )

    op.create_table(
        "moderation_audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("entity_type", sa.String(length=32), nullable=False),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_moderation_audit_logs_entity_type", "moderation_audit_logs", ["entity_type"])
    op.create_index("ix_moderation_audit_logs_entity_id", "moderation_audit_logs", ["entity_id"])
    op.create_index("ix_moderation_audit_logs_user_id", "moderation_audit_logs", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_moderation_audit_logs_user_id", table_name="moderation_audit_logs")
    op.drop_index("ix_moderation_audit_logs_entity_id", table_name="moderation_audit_logs")
    op.drop_index("ix_moderation_audit_logs_entity_type", table_name="moderation_audit_logs")
    op.drop_table("moderation_audit_logs")

    op.drop_column("special_equipment_listings", "pending_changes")
    op.drop_column("quarries", "pending_changes")

    op.execute("ALTER TABLE special_equipment_listings ALTER COLUMN moderation_status DROP DEFAULT")
    op.execute("ALTER TABLE quarries ALTER COLUMN moderation_status DROP DEFAULT")
    op.execute("ALTER TABLE vehicles ALTER COLUMN moderation_status DROP DEFAULT")
    op.execute("ALTER TABLE drivers ALTER COLUMN moderation_status DROP DEFAULT")

    op.execute("ALTER TYPE moderation_status RENAME TO moderation_status_old")
    op.execute(
        "CREATE TYPE moderation_status AS ENUM "
        "('incomplete', 'pending_moderation', 'approved', 'rejected', 'suspended')"
    )

    for table_name, default_value in (
        ("special_equipment_listings", "pending_moderation"),
        ("quarries", "incomplete"),
        ("vehicles", "incomplete"),
        ("drivers", "incomplete"),
    ):
        op.execute(
            f"""
            ALTER TABLE {table_name}
            ALTER COLUMN moderation_status TYPE moderation_status
            USING (
                CASE
                    WHEN moderation_status::text = 'has_pending_changes' THEN 'approved'
                    ELSE moderation_status::text
                END
            )::moderation_status
            """
        )
        op.execute(
            f"ALTER TABLE {table_name} ALTER COLUMN moderation_status "
            f"SET DEFAULT '{default_value}'::moderation_status"
        )

    op.execute("DROP TYPE moderation_status_old")
