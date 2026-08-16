"""add sprint 20 driver location telemetry

Revision ID: b8c9d0e1f2a3
Revises: a0f6e2c4b8d1
Create Date: 2026-08-16 11:10:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "b8c9d0e1f2a3"
down_revision: Union[str, None] = "a0f6e2c4b8d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "drivers",
        sa.Column("is_on_shift", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("drivers", sa.Column("last_lat", sa.Float(), nullable=True))
    op.add_column("drivers", sa.Column("last_lon", sa.Float(), nullable=True))
    op.add_column(
        "drivers",
        sa.Column("last_location_updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_drivers_last_location_updated_at", "drivers", ["last_location_updated_at"])
    op.create_check_constraint(
        "ck_drivers_last_lat_range",
        "drivers",
        "last_lat IS NULL OR (last_lat >= -90 AND last_lat <= 90)",
    )
    op.create_check_constraint(
        "ck_drivers_last_lon_range",
        "drivers",
        "last_lon IS NULL OR (last_lon >= -180 AND last_lon <= 180)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_drivers_last_lon_range", "drivers", type_="check")
    op.drop_constraint("ck_drivers_last_lat_range", "drivers", type_="check")
    op.drop_index("ix_drivers_last_location_updated_at", table_name="drivers")
    op.drop_column("drivers", "last_location_updated_at")
    op.drop_column("drivers", "last_lon")
    op.drop_column("drivers", "last_lat")
    op.drop_column("drivers", "is_on_shift")
