"""Add quarries and OSRM client order support

Revision ID: 6f0e1d2c3b4a
Revises: 4c2d7f9e8a10
Create Date: 2026-06-30 04:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "6f0e1d2c3b4a"
down_revision: Union[str, None] = "4c2d7f9e8a10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "quarries",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("address", sa.Text(), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lon", sa.Float(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "quarry_materials",
        sa.Column("quarry_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("material_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["quarry_id"], ["quarries.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("quarry_id", "material_id"),
    )

    op.add_column("orders", sa.Column("quarry_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_orders_quarry_id_quarries",
        "orders",
        "quarries",
        ["quarry_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_orders_quarry_id_quarries", "orders", type_="foreignkey")
    op.drop_column("orders", "quarry_id")
    op.drop_table("quarry_materials")
    op.drop_table("quarries")
