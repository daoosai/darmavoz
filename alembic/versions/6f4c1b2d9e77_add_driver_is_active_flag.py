"""Add driver is_active flag

Revision ID: 6f4c1b2d9e77
Revises: 9f1c2b7d4e11
Create Date: 2026-06-17 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "6f4c1b2d9e77"
down_revision: Union[str, None] = "9f1c2b7d4e11"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("drivers", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.execute("UPDATE drivers SET is_active = true WHERE is_active IS NULL")
    op.alter_column("drivers", "is_active", server_default=None)


def downgrade() -> None:
    op.drop_column("drivers", "is_active")
