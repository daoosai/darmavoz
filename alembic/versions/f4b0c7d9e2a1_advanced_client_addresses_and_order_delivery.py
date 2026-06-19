"""advanced client addresses and order delivery

Revision ID: f4b0c7d9e2a1
Revises: d2f6c4b8a1e3
Create Date: 2026-06-19 09:10:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "f4b0c7d9e2a1"
down_revision: Union[str, None] = "d2f6c4b8a1e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("client_addresses", "city", new_column_name="comment")
    op.alter_column(
        "client_addresses",
        "comment",
        existing_type=sa.String(length=255),
        type_=sa.String(length=500),
        existing_nullable=True,
    )
    op.add_column("orders", sa.Column("delivery_address", sa.Text(), nullable=True))
    op.add_column("orders", sa.Column("delivery_lat", sa.Float(), nullable=True))
    op.add_column("orders", sa.Column("delivery_lon", sa.Float(), nullable=True))
    op.execute("UPDATE orders SET delivery_address = address WHERE delivery_address IS NULL AND address IS NOT NULL")


def downgrade() -> None:
    op.drop_column("orders", "delivery_lon")
    op.drop_column("orders", "delivery_lat")
    op.drop_column("orders", "delivery_address")
    op.alter_column(
        "client_addresses",
        "comment",
        existing_type=sa.String(length=500),
        type_=sa.String(length=255),
        existing_nullable=True,
    )
    op.alter_column("client_addresses", "comment", new_column_name="city")
