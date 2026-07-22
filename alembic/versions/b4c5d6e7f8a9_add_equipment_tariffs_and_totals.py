"""Add equipment tariffs and application totals.

Revision ID: b4c5d6e7f8a9
Revises: a3b4c5d6e7f8
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "b4c5d6e7f8a9"
down_revision: Union[str, None] = "a3b4c5d6e7f8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "special_equipment_listings",
        sa.Column("tariffs", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "special_equipment_applications",
        sa.Column("total_price", sa.Numeric(12, 2), nullable=True),
    )

    op.execute(
        """
        UPDATE special_equipment_listings
        SET tariffs = CASE
            WHEN price_unit = 'shift' THEN jsonb_build_array(
                jsonb_build_object('type', 'hour', 'price', price_amount),
                jsonb_build_object('type', 'shift', 'hours', 1, 'price', price_amount)
            )
            ELSE jsonb_build_array(
                jsonb_build_object('type', 'hour', 'price', price_amount)
            )
        END
        """
    )
    op.execute(
        """
        UPDATE special_equipment_applications AS application
        SET total_price = ROUND((listing.price_amount * application.duration_value)::numeric, 2)
        FROM special_equipment_listings AS listing
        WHERE listing.id = application.listing_id
          AND listing.price_amount IS NOT NULL
        """
    )

    op.alter_column(
        "special_equipment_listings",
        "tariffs",
        nullable=False,
        server_default=sa.text("'[]'::jsonb"),
    )
    op.drop_constraint(
        "ck_special_equipment_price",
        "special_equipment_listings",
        type_="check",
    )
    op.drop_constraint(
        "ck_special_equipment_price_unit",
        "special_equipment_listings",
        type_="check",
    )
    op.drop_column("special_equipment_listings", "price_amount")
    op.drop_column("special_equipment_listings", "price_unit")

    op.drop_constraint(
        "ck_special_equipment_application_status",
        "special_equipment_applications",
        type_="check",
    )
    op.create_check_constraint(
        "ck_special_equipment_application_status",
        "special_equipment_applications",
        "status IN ('new', 'in_progress', 'closed', 'completed', 'rejected', 'cancelled')",
    )


def downgrade() -> None:
    op.execute(
        "UPDATE special_equipment_applications SET status = 'closed' WHERE status = 'completed'"
    )
    op.drop_constraint(
        "ck_special_equipment_application_status",
        "special_equipment_applications",
        type_="check",
    )
    op.create_check_constraint(
        "ck_special_equipment_application_status",
        "special_equipment_applications",
        "status IN ('new', 'in_progress', 'closed', 'rejected', 'cancelled')",
    )

    op.add_column(
        "special_equipment_listings",
        sa.Column("price_unit", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "special_equipment_listings",
        sa.Column("price_amount", sa.Numeric(12, 2), nullable=True),
    )
    op.execute(
        """
        UPDATE special_equipment_listings
        SET price_amount = NULLIF(tariffs->0->>'price', '')::numeric,
            price_unit = CASE
                WHEN tariffs->0->>'price' IS NULL THEN 'negotiable'
                ELSE 'hour'
            END
        """
    )
    op.alter_column("special_equipment_listings", "price_unit", nullable=False)
    op.create_check_constraint(
        "ck_special_equipment_price_unit",
        "special_equipment_listings",
        "price_unit IN ('hour', 'shift', 'day', 'negotiable')",
    )
    op.create_check_constraint(
        "ck_special_equipment_price",
        "special_equipment_listings",
        "(price_unit = 'negotiable' AND price_amount IS NULL) OR "
        "(price_unit <> 'negotiable' AND price_amount IS NOT NULL AND price_amount > 0)",
    )
    op.drop_column("special_equipment_listings", "tariffs")
    op.drop_column("special_equipment_applications", "total_price")
