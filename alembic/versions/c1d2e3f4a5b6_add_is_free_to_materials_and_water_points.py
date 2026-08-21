"""add is_free flags to materials and water points

Revision ID: c1d2e3f4a5b6
Revises: b8c9d0e1f2a3
Create Date: 2026-08-22 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine.reflection import Inspector


revision: str = "c1d2e3f4a5b6"
down_revision: Union[str, None] = "b8c9d0e1f2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)

    material_columns = {column["name"] for column in inspector.get_columns("materials")}
    if "is_free" not in material_columns:
        op.add_column(
            "materials",
            sa.Column("is_free", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )

    water_columns = {column["name"] for column in inspector.get_columns("water_points")}
    if "is_free" not in water_columns:
        op.add_column(
            "water_points",
            sa.Column("is_free", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )

    check_constraints = {
        constraint["name"] for constraint in inspector.get_check_constraints("water_points")
    }
    if "ck_paid_water_required" in check_constraints:
        op.drop_constraint("ck_paid_water_required", "water_points", type_="check")
    op.create_check_constraint(
        "ck_paid_water_required",
        "water_points",
        "water_type <> 'paid' OR (name IS NOT NULL AND btrim(name) <> '' AND phone IS NOT NULL AND btrim(phone) <> '' AND (is_free OR (price > 0 AND price_unit IS NOT NULL AND btrim(price_unit) <> '')))",
    )


def downgrade() -> None:
    op.drop_constraint("ck_paid_water_required", "water_points", type_="check")
    op.create_check_constraint(
        "ck_paid_water_required",
        "water_points",
        "water_type <> 'paid' OR (name IS NOT NULL AND btrim(name) <> '' AND phone IS NOT NULL AND btrim(phone) <> '' AND price > 0 AND price_unit IS NOT NULL AND btrim(price_unit) <> '')",
    )
    op.drop_column("water_points", "is_free")
    op.drop_column("materials", "is_free")
