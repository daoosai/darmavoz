"""sprint 14 pickup points

Revision ID: a14b2c3d4e5f
Revises: 7c4d5e6f7a89
Create Date: 2026-07-14 12:00:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "a14b2c3d4e5f"
down_revision: Union[str, None] = "7c4d5e6f7a89"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pickup_point_type = postgresql.ENUM(
        "quarry",
        "accumulator",
        "warehouse",
        "supplier",
        name="pickup_point_type",
    )
    pickup_point_type.create(op.get_bind(), checkfirst=True)

    op.add_column("quarries", sa.Column("short_name", sa.String(length=100), nullable=True))
    op.add_column(
        "quarries",
        sa.Column(
            "point_type",
            pickup_point_type,
            server_default="quarry",
            nullable=False,
        ),
    )
    op.add_column("quarries", sa.Column("description", sa.Text(), nullable=True))
    op.add_column(
        "quarries",
        sa.Column("min_delivery_price", sa.Numeric(12, 2), nullable=True),
    )
    op.add_column(
        "quarries",
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "quarries",
        sa.Column(
            "moderation_status",
            postgresql.ENUM(
                "incomplete",
                "pending_moderation",
                "approved",
                "rejected",
                "suspended",
                name="moderation_status",
                create_type=False,
            ),
            server_default="approved",
            nullable=False,
        ),
    )
    op.add_column("quarries", sa.Column("moderation_comment", sa.Text(), nullable=True))
    op.add_column(
        "quarries",
        sa.Column("moderated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "quarries",
        sa.Column("moderated_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "quarries",
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.add_column(
        "quarries",
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_foreign_key(
        "fk_quarries_owner_user_id_users",
        "quarries",
        "users",
        ["owner_user_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_quarries_moderated_by_user_id_users",
        "quarries",
        "users",
        ["moderated_by_user_id"],
        ["id"],
    )
    op.create_index("ix_quarries_owner_user_id", "quarries", ["owner_user_id"])
    op.create_index("ix_quarries_point_type", "quarries", ["point_type"])
    op.create_index("ix_quarries_moderation_status", "quarries", ["moderation_status"])

    op.add_column("quarry_materials", sa.Column("price", sa.Numeric(12, 2), nullable=True))
    op.add_column(
        "quarry_materials",
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )
    op.add_column(
        "quarry_materials",
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.add_column(
        "quarry_materials",
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )

    op.create_table(
        "quarry_delivery_options",
        sa.Column("quarry_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("quarries.id"), primary_key=True),
        sa.Column(
            "delivery_option_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("delivery_options.id"),
            primary_key=True,
        ),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )
    op.add_column(
        "cart_items",
        sa.Column("quarry_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_cart_items_quarry_id_quarries",
        "cart_items",
        "quarries",
        ["quarry_id"],
        ["id"],
    )

    conn = op.get_bind()
    conn.execute(sa.text("UPDATE quarries SET min_delivery_price = 5000 WHERE min_delivery_price IS NULL"))
    conn.execute(
        sa.text(
            """
            UPDATE quarry_materials qm
            SET price = m.price
            FROM materials m
            WHERE qm.material_id = m.id AND qm.price IS NULL
            """
        )
    )
    conn.execute(
        sa.text(
            "UPDATE delivery_options SET min_delivery_price = 3000 WHERE capacity_m3 = 5"
        )
    )
    conn.execute(
        sa.text(
            """
            INSERT INTO quarry_delivery_options (quarry_id, delivery_option_id, is_active)
            SELECT q.id, d.id, true
            FROM quarries q
            CROSS JOIN delivery_options d
            WHERE d.capacity_m3 >= 10 AND d.is_active = true
            ON CONFLICT DO NOTHING
            """
        )
    )


def downgrade() -> None:
    op.drop_constraint("fk_cart_items_quarry_id_quarries", "cart_items", type_="foreignkey")
    op.drop_column("cart_items", "quarry_id")
    op.drop_table("quarry_delivery_options")
    for column_name in ("updated_at", "created_at", "is_active", "price"):
        op.drop_column("quarry_materials", column_name)
    op.drop_index("ix_quarries_moderation_status", table_name="quarries")
    op.drop_index("ix_quarries_point_type", table_name="quarries")
    op.drop_index("ix_quarries_owner_user_id", table_name="quarries")
    op.drop_constraint("fk_quarries_moderated_by_user_id_users", "quarries", type_="foreignkey")
    op.drop_constraint("fk_quarries_owner_user_id_users", "quarries", type_="foreignkey")
    for column_name in (
        "updated_at",
        "created_at",
        "moderated_by_user_id",
        "moderated_at",
        "moderation_comment",
        "moderation_status",
        "owner_user_id",
        "min_delivery_price",
        "description",
        "point_type",
        "short_name",
    ):
        op.drop_column("quarries", column_name)
    postgresql.ENUM(name="pickup_point_type").drop(op.get_bind(), checkfirst=True)
