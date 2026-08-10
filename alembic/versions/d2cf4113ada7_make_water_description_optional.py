"""make water description optional

Revision ID: d2cf4113ada7
Revises: e9f0a1b2c3d4
Create Date: 2026-08-10 01:28:07.574053

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd2cf4113ada7'
down_revision: Union[str, None] = 'e9f0a1b2c3d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("ck_paid_water_required", "water_points", type_="check")
    op.create_check_constraint(
        "ck_paid_water_required",
        "water_points",
        "water_type <> 'paid' OR (name IS NOT NULL AND btrim(name) <> '' AND phone IS NOT NULL AND btrim(phone) <> '' AND price > 0 AND price_unit IS NOT NULL AND btrim(price_unit) <> '')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_paid_water_required", "water_points", type_="check")
    op.create_check_constraint(
        "ck_paid_water_required",
        "water_points",
        "water_type <> 'paid' OR (name IS NOT NULL AND btrim(name) <> '' AND phone IS NOT NULL AND btrim(phone) <> '' AND price > 0 AND price_unit IS NOT NULL AND btrim(price_unit) <> '' AND description IS NOT NULL AND btrim(description) <> '')",
    )
