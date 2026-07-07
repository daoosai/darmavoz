"""Epic soft delete, min delivery price, and telemetry

Revision ID: b9c1d2e3f4a5
Revises: 9f1c2b7d4e11
Create Date: 2026-07-01 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "b9c1d2e3f4a5"
down_revision: Union[str, None] = "9f1c2b7d4e11"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "delivery_options",
        sa.Column("min_delivery_price", sa.Float(), nullable=False, server_default=sa.text("5000")),
    )
    op.create_table(
        "error_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("error_code", sa.String(length=32), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_error_logs_error_code"), "error_logs", ["error_code"], unique=False)
    op.create_index(op.f("ix_error_logs_user_id"), "error_logs", ["user_id"], unique=False)

    op.execute(
        """
        UPDATE delivery_options
        SET min_delivery_price = CASE
            WHEN capacity_m3 <= 5 THEN 3500
            WHEN capacity_m3 <= 10 THEN 4000
            ELSE 5000
        END
        WHERE min_delivery_price IS NULL OR min_delivery_price = 5000
        """
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_error_logs_user_id"), table_name="error_logs")
    op.drop_index(op.f("ix_error_logs_error_code"), table_name="error_logs")
    op.drop_table("error_logs")
    op.drop_column("delivery_options", "min_delivery_price")
    op.drop_column("orders", "is_deleted")
