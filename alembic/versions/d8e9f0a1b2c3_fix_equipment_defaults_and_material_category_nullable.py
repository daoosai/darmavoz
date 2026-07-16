"""Fix equipment soft delete defaults and material category nullability.

Revision ID: d8e9f0a1b2c3
Revises: c6d7e8f9a0b1
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d8e9f0a1b2c3"
down_revision: Union[str, None] = "c6d7e8f9a0b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE special_equipment_listings
        SET is_deleted = FALSE
        WHERE is_deleted IS NULL
        """
    )
    op.alter_column(
        "special_equipment_listings",
        "is_deleted",
        existing_type=sa.Boolean(),
        nullable=False,
        server_default=sa.text("false"),
    )
    op.execute(
        """
        UPDATE special_equipment_listings
        SET is_deleted = TRUE,
            is_active = FALSE
        WHERE lower(trim(title)) IN ('t-100', 'т-100')
        """
    )
    op.alter_column(
        "materials",
        "category_id",
        existing_type=sa.UUID(),
        nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "materials",
        "category_id",
        existing_type=sa.UUID(),
        nullable=False,
    )
    op.alter_column(
        "special_equipment_listings",
        "is_deleted",
        existing_type=sa.Boolean(),
        nullable=False,
        server_default=None,
    )
