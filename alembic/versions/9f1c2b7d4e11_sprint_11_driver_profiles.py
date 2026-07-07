"""Sprint 11 driver profiles and vehicle moderation

Revision ID: 9f1c2b7d4e11
Revises: 8d4a1c2d5b61
Create Date: 2026-06-16 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "9f1c2b7d4e11"
down_revision: Union[str, None] = "8d4a1c2d5b61"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


moderation_status_enum = sa.Enum(
    "pending_moderation",
    "approved",
    "rejected",
    "suspended",
    name="moderation_status",
)
vehicle_rate_mode_enum = sa.Enum("per_ton_km", "fixed", name="vehicle_rate_mode")


def upgrade() -> None:
    bind = op.get_bind()
    moderation_status_enum.create(bind, checkfirst=True)
    vehicle_rate_mode_enum.create(bind, checkfirst=True)

    op.add_column(
        "drivers",
        sa.Column(
            "moderation_status",
            moderation_status_enum,
            nullable=False,
            server_default="approved",
        ),
    )
    op.add_column("drivers", sa.Column("moderation_comment", sa.Text(), nullable=True))
    op.add_column("drivers", sa.Column("moderated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("drivers", sa.Column("moderated_by_user_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_drivers_moderated_by_user_id_users",
        "drivers",
        "users",
        ["moderated_by_user_id"],
        ["id"],
    )
    op.create_index("ix_drivers_moderation_status", "drivers", ["moderation_status"], unique=False)

    op.add_column("vehicles", sa.Column("brand", sa.String(length=255), nullable=True))
    op.add_column("vehicles", sa.Column("model", sa.String(length=255), nullable=True))
    op.add_column("vehicles", sa.Column("vehicle_type", sa.String(length=100), nullable=True))
    op.add_column("vehicles", sa.Column("body_volume_m3", sa.Float(), nullable=True))
    op.add_column("vehicles", sa.Column("rate_mode", vehicle_rate_mode_enum, nullable=True))
    op.add_column("vehicles", sa.Column("rate_per_ton_km", sa.Float(), nullable=True))
    op.add_column("vehicles", sa.Column("fixed_rate", sa.Float(), nullable=True))
    op.add_column(
        "vehicles",
        sa.Column(
            "moderation_status",
            moderation_status_enum,
            nullable=False,
            server_default="approved",
        ),
    )
    op.add_column("vehicles", sa.Column("moderation_comment", sa.Text(), nullable=True))
    op.add_column("vehicles", sa.Column("moderated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("vehicles", sa.Column("moderated_by_user_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_vehicles_moderated_by_user_id_users",
        "vehicles",
        "users",
        ["moderated_by_user_id"],
        ["id"],
    )
    op.create_index("ix_vehicles_moderation_status", "vehicles", ["moderation_status"], unique=False)

    op.execute("UPDATE drivers SET moderation_status = 'approved'")
    op.execute("UPDATE vehicles SET moderation_status = 'approved'")

    op.alter_column("drivers", "moderation_status", server_default=None)
    op.alter_column("vehicles", "moderation_status", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_vehicles_moderation_status", table_name="vehicles")
    op.drop_constraint("fk_vehicles_moderated_by_user_id_users", "vehicles", type_="foreignkey")
    op.drop_column("vehicles", "moderated_by_user_id")
    op.drop_column("vehicles", "moderated_at")
    op.drop_column("vehicles", "moderation_comment")
    op.drop_column("vehicles", "moderation_status")
    op.drop_column("vehicles", "fixed_rate")
    op.drop_column("vehicles", "rate_per_ton_km")
    op.drop_column("vehicles", "rate_mode")
    op.drop_column("vehicles", "body_volume_m3")
    op.drop_column("vehicles", "vehicle_type")
    op.drop_column("vehicles", "model")
    op.drop_column("vehicles", "brand")

    op.drop_index("ix_drivers_moderation_status", table_name="drivers")
    op.drop_constraint("fk_drivers_moderated_by_user_id_users", "drivers", type_="foreignkey")
    op.drop_column("drivers", "moderated_by_user_id")
    op.drop_column("drivers", "moderated_at")
    op.drop_column("drivers", "moderation_comment")
    op.drop_column("drivers", "moderation_status")

    bind = op.get_bind()
    vehicle_rate_mode_enum.drop(bind, checkfirst=True)
    moderation_status_enum.drop(bind, checkfirst=True)
