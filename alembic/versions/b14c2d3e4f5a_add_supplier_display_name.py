"""add supplier display name

Revision ID: b14c2d3e4f5a
Revises: a14b2c3d4e5f
Create Date: 2026-07-14 14:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "b14c2d3e4f5a"
down_revision: Union[str, None] = "a14b2c3d4e5f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("display_name", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "display_name")
