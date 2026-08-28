"""Sprint 21 2GIS parsing and point CRM.

Revision ID: c2e3f4a5b6c7
Revises: c1d2e3f4a5b7
Create Date: 2026-08-25 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "c2e3f4a5b6c7"
down_revision: Union[str, None] = "c1d2e3f4a5b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


crm_status = postgresql.ENUM("parsed", "active", "rejected", name="crm_status", create_type=False)
point_kind = postgresql.ENUM(
    "quarry",
    "water",
    name="point_audit_point_kind",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    crm_status.create(bind, checkfirst=True)
    point_kind.create(bind, checkfirst=True)

    op.execute("ALTER TYPE water_point_type ADD VALUE IF NOT EXISTS 'unknown'")

    for table_name in ("quarries", "water_points"):
        op.add_column(table_name, sa.Column("twogis_id", sa.String(length=128), nullable=True))
        op.add_column(
            table_name,
            sa.Column(
                "crm_status",
                crm_status,
                nullable=False,
                server_default=sa.text("'active'::crm_status"),
            ),
        )
        op.add_column(table_name, sa.Column("crm_comment", sa.Text(), nullable=True))
        op.add_column(
            table_name,
            sa.Column("parsed_data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        )
        op.create_index(
            f"ix_{table_name}_twogis_id",
            table_name,
            ["twogis_id"],
            unique=True,
        )
        op.create_index(
            f"ix_{table_name}_crm_status",
            table_name,
            ["crm_status"],
            unique=False,
        )
        op.execute(f"UPDATE {table_name} SET crm_status = 'active'")

    op.alter_column("water_points", "owner_user_id", existing_type=postgresql.UUID(as_uuid=True), nullable=True)

    op.create_table(
        "point_audit_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("point_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("point_kind", point_kind, nullable=False),
        sa.Column("admin_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("old_status", crm_status, nullable=True),
        sa.Column("new_status", crm_status, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["admin_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_point_audit_log_point_created",
        "point_audit_log",
        ["point_kind", "point_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_point_audit_log_point_created", table_name="point_audit_log")
    op.drop_table("point_audit_log")
    op.alter_column("water_points", "owner_user_id", existing_type=postgresql.UUID(as_uuid=True), nullable=False)

    for table_name in ("water_points", "quarries"):
        op.drop_index(f"ix_{table_name}_crm_status", table_name=table_name)
        op.drop_index(f"ix_{table_name}_twogis_id", table_name=table_name)
        op.drop_column(table_name, "parsed_data")
        op.drop_column(table_name, "crm_comment")
        op.drop_column(table_name, "crm_status")
        op.drop_column(table_name, "twogis_id")

    point_kind.drop(op.get_bind(), checkfirst=True)
    crm_status.drop(op.get_bind(), checkfirst=True)
    # PostgreSQL cannot remove one enum value safely; `unknown` remains on downgrade.
