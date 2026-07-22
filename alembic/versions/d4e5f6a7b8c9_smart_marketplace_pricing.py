"""smart marketplace pricing

Revision ID: d4e5f6a7b8c9
Revises: b14c2d3e4f5a
Create Date: 2026-07-15 10:00:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, None] = "b14c2d3e4f5a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "delivery_options",
        sa.Column(
            "min_price_quarry",
            sa.Float(),
            nullable=False,
            server_default=sa.text("5000"),
        ),
    )
    op.add_column(
        "delivery_options",
        sa.Column(
            "min_price_warehouse",
            sa.Float(),
            nullable=False,
            server_default=sa.text("3000"),
        ),
    )
    op.execute(
        """
        UPDATE delivery_options
        SET min_price_quarry = COALESCE(min_delivery_price, 5000),
            min_price_warehouse = 3000
        """
    )
    op.drop_column("delivery_options", "min_delivery_price")

    op.add_column(
        "quarries",
        sa.Column(
            "rating",
            sa.Float(),
            nullable=False,
            server_default=sa.text("5.0"),
        ),
    )


def downgrade() -> None:
    op.add_column(
        "delivery_options",
        sa.Column(
            "min_delivery_price",
            sa.Float(),
            nullable=False,
            server_default=sa.text("5000"),
        ),
    )
    op.execute(
        """
        UPDATE delivery_options
        SET min_delivery_price = min_price_quarry
        """
    )
    op.drop_column("delivery_options", "min_price_warehouse")
    op.drop_column("delivery_options", "min_price_quarry")
    op.drop_column("quarries", "rating")
