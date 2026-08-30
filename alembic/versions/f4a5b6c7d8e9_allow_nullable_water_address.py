"""Allow water points to be saved with coordinates only.

Revision ID: f4a5b6c7d8e9
Revises: f3a4b5c6d7e8
Create Date: 2026-08-30 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "f4a5b6c7d8e9"
down_revision: Union[str, None] = "f3a4b5c6d7e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "water_points",
        "address",
        existing_type=sa.Text(),
        nullable=True,
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE water_points
        SET address = 'Координаты: ' || lat::text || ', ' || lon::text
        WHERE address IS NULL
        """
    )
    op.alter_column(
        "water_points",
        "address",
        existing_type=sa.Text(),
        nullable=False,
    )
