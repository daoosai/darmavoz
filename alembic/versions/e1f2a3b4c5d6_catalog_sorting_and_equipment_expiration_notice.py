"""Add catalog sorting indexes and equipment expiration notice tracking.

Revision ID: e1f2a3b4c5d6
Revises: d6e7f8a9b0c1
Create Date: 2026-08-28 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, None] = "d6e7f8a9b0c1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_materials_sort_order", "materials", ["sort_order"], unique=False)
    op.create_index(
        "ix_special_equipment_types_sort_order",
        "special_equipment_types",
        ["sort_order"],
        unique=False,
    )
    op.add_column(
        "special_equipment_listings",
        sa.Column(
            "expiration_notice_sent",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("special_equipment_listings", "expiration_notice_sent")
    op.drop_index(
        "ix_special_equipment_types_sort_order",
        table_name="special_equipment_types",
    )
    op.drop_index("ix_materials_sort_order", table_name="materials")
