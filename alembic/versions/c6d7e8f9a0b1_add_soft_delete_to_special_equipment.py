"""Add soft delete flag to special equipment listings.

Revision ID: c6d7e8f9a0b1
Revises: b4c5d6e7f8a9
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c6d7e8f9a0b1"
down_revision: Union[str, None] = "b4c5d6e7f8a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "special_equipment_listings",
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index(
        "ix_special_equipment_listings_is_deleted",
        "special_equipment_listings",
        ["is_deleted"],
    )
    op.alter_column("special_equipment_listings", "is_deleted", server_default=None)


def downgrade() -> None:
    op.drop_index(
        "ix_special_equipment_listings_is_deleted",
        table_name="special_equipment_listings",
    )
    op.drop_column("special_equipment_listings", "is_deleted")
