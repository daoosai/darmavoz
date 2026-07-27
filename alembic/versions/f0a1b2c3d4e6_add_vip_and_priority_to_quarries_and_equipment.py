"""add vip and manual priority to quarries and special equipment

Revision ID: f0a1b2c3d4e6
Revises: e9f1a2b3c4d5
Create Date: 2026-07-27 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "f0a1b2c3d4e6"
down_revision = "e9f1a2b3c4d5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "quarries",
        sa.Column("is_vip", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "quarries",
        sa.Column("manual_priority", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "special_equipment_listings",
        sa.Column("is_vip", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "special_equipment_listings",
        sa.Column("manual_priority", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "special_equipment_listings",
        sa.Column("price_from", sa.Numeric(12, 2), nullable=True),
    )

    op.execute(
        """
        UPDATE special_equipment_listings AS sel
        SET price_from = pricing.min_price
        FROM (
            SELECT
                id,
                MIN(NULLIF(item->>'price', '')::numeric(12, 2)) AS min_price
            FROM special_equipment_listings
            CROSS JOIN LATERAL jsonb_array_elements(tariffs) AS item
            WHERE jsonb_typeof(tariffs) = 'array'
              AND item ? 'price'
              AND NULLIF(item->>'price', '') IS NOT NULL
            GROUP BY id
        ) AS pricing
        WHERE sel.id = pricing.id
        """
    )

    op.alter_column("quarries", "is_vip", server_default=None)
    op.alter_column("quarries", "manual_priority", server_default=None)
    op.alter_column("special_equipment_listings", "is_vip", server_default=None)
    op.alter_column("special_equipment_listings", "manual_priority", server_default=None)


def downgrade() -> None:
    op.drop_column("special_equipment_listings", "price_from")
    op.drop_column("special_equipment_listings", "manual_priority")
    op.drop_column("special_equipment_listings", "is_vip")
    op.drop_column("quarries", "manual_priority")
    op.drop_column("quarries", "is_vip")
