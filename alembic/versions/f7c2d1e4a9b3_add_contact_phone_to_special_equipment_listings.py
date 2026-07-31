"""add contact phone to special equipment listings

Revision ID: f7c2d1e4a9b3
Revises: f0a1b2c3d4e6
Create Date: 2026-07-29 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "f7c2d1e4a9b3"
down_revision = "f0a1b2c3d4e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "special_equipment_listings",
        sa.Column("contact_phone", sa.String(length=20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("special_equipment_listings", "contact_phone")
