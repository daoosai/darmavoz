"""driver registration vehicle draft fields

Revision ID: b7d9e2c4a1f0
Revises: 6f4c1b2d9e77, c3f4e5a6b7c8
Create Date: 2026-06-18 15:10:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "b7d9e2c4a1f0"
down_revision: Union[str, tuple[str, str], None] = ("6f4c1b2d9e77", "c3f4e5a6b7c8")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("vehicles", sa.Column("cubature_min", sa.Float(), nullable=True))
    op.add_column("vehicles", sa.Column("cubature_max", sa.Float(), nullable=True))
    op.add_column("vehicles", sa.Column("tonnage_min", sa.Float(), nullable=True))
    op.add_column("vehicles", sa.Column("tonnage_max", sa.Float(), nullable=True))
    op.alter_column("vehicles", "delivery_option_id", existing_type=sa.UUID(), nullable=True)


def downgrade() -> None:
    op.execute("DELETE FROM vehicles WHERE delivery_option_id IS NULL")
    op.alter_column("vehicles", "delivery_option_id", existing_type=sa.UUID(), nullable=False)
    op.drop_column("vehicles", "tonnage_max")
    op.drop_column("vehicles", "tonnage_min")
    op.drop_column("vehicles", "cubature_max")
    op.drop_column("vehicles", "cubature_min")
