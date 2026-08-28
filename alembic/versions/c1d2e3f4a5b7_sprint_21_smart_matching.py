"""Sprint 21 smart driver matching.

Revision ID: c1d2e3f4a5b7
Revises: c1d2e3f4a5b6
Create Date: 2026-08-24 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "c1d2e3f4a5b7"
down_revision: Union[str, None] = "c1d2e3f4a5b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "drivers",
        sa.Column("rating", sa.Numeric(2, 1), nullable=False, server_default="5.0"),
    )
    op.add_column(
        "drivers",
        sa.Column("is_dispatch_eligible", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.add_column(
        "drivers",
        sa.Column("dispatch_admission_score", sa.SmallInteger(), nullable=False, server_default="100"),
    )
    op.add_column("drivers", sa.Column("dispatch_admission_comment", sa.Text(), nullable=True))
    op.create_check_constraint("ck_drivers_rating_range", "drivers", "rating >= 1 AND rating <= 5")
    op.create_check_constraint(
        "ck_drivers_dispatch_admission_score_range",
        "drivers",
        "dispatch_admission_score >= 0 AND dispatch_admission_score <= 100",
    )
    op.alter_column("drivers", "rating", server_default=None)
    op.alter_column("drivers", "is_dispatch_eligible", server_default=None)
    op.alter_column("drivers", "dispatch_admission_score", server_default=None)

    op.create_table(
        "order_distribution_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("calculated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("trigger_source", sa.String(length=32), nullable=False),
        sa.Column("algorithm_version", sa.String(length=32), nullable=False),
        sa.Column("input_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("candidates_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("recommended_driver_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("selected_driver_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("distance_source", sa.String(length=32), nullable=False),
        sa.Column("twogis_status", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"]),
        sa.ForeignKeyConstraint(["recommended_driver_id"], ["drivers.id"]),
        sa.ForeignKeyConstraint(["selected_driver_id"], ["drivers.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_order_distribution_history_order_calculated_at",
        "order_distribution_history",
        ["order_id", "calculated_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_order_distribution_history_order_calculated_at", table_name="order_distribution_history")
    op.drop_table("order_distribution_history")
    op.drop_constraint("ck_drivers_dispatch_admission_score_range", "drivers", type_="check")
    op.drop_constraint("ck_drivers_rating_range", "drivers", type_="check")
    op.drop_column("drivers", "dispatch_admission_comment")
    op.drop_column("drivers", "dispatch_admission_score")
    op.drop_column("drivers", "is_dispatch_eligible")
    op.drop_column("drivers", "rating")
