"""Sprint 12 delivery mileage and route pricing

Revision ID: 4c2d7f9e8a10
Revises: f1e2d3c4b5a6
Create Date: 2026-06-29 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "4c2d7f9e8a10"
down_revision: Union[str, None] = "f1e2d3c4b5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("delivery_options", sa.Column("delivery_rate_per_km", sa.Float(), nullable=True))

    op.add_column("orders", sa.Column("pickup_address", sa.Text(), nullable=True))
    op.add_column("orders", sa.Column("pickup_lat", sa.Float(), nullable=True))
    op.add_column("orders", sa.Column("pickup_lon", sa.Float(), nullable=True))
    op.add_column("orders", sa.Column("mileage_km", sa.Float(), nullable=True))
    op.add_column("orders", sa.Column("delivery_rate_per_km_snapshot", sa.Float(), nullable=True))
    op.add_column("orders", sa.Column("delivery_cost", sa.Float(), nullable=True))
    op.add_column("orders", sa.Column("calculation_source", sa.String(length=50), nullable=True))
    op.add_column("orders", sa.Column("route_calculated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "route_calculated_at")
    op.drop_column("orders", "calculation_source")
    op.drop_column("orders", "delivery_cost")
    op.drop_column("orders", "delivery_rate_per_km_snapshot")
    op.drop_column("orders", "mileage_km")
    op.drop_column("orders", "pickup_lon")
    op.drop_column("orders", "pickup_lat")
    op.drop_column("orders", "pickup_address")

    op.drop_column("delivery_options", "delivery_rate_per_km")
