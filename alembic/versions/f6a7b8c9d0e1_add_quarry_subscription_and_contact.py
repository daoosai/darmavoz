"""Add quarry subscription and contact fields.

Revision ID: f6a7b8c9d0e1
Revises: e4f5a6b7c8d9
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, None] = "e4f5a6b7c8d9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "quarries",
        sa.Column("contact_phone", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "quarries",
        sa.Column("subscription_end_date", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        op.f("ix_quarries_subscription_end_date"),
        "quarries",
        ["subscription_end_date"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_quarries_subscription_end_date"), table_name="quarries")
    op.drop_column("quarries", "subscription_end_date")
    op.drop_column("quarries", "contact_phone")
