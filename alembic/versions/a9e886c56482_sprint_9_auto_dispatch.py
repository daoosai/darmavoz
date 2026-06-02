"""Sprint 9 auto dispatch

Revision ID: a9e886c56482
Revises: 21f5334b7d4f
Create Date: 2026-06-02 11:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "a9e886c56482"
down_revision: Union[str, None] = "21f5334b7d4f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "vehicles",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("plate_number", sa.String(length=50), nullable=True),
        sa.Column("delivery_option_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["delivery_option_id"], ["delivery_options.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    op.add_column("drivers", sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("drivers", sa.Column("vehicle_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column(
        "drivers",
        sa.Column("is_auto_dispatch_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.add_column(
        "drivers",
        sa.Column("dispatch_priority", sa.Integer(), nullable=False, server_default="100"),
    )
    op.add_column("drivers", sa.Column("temporary_penalty_until", sa.DateTime(timezone=True), nullable=True))
    op.add_column("drivers", sa.Column("last_offer_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key("fk_drivers_user_id_users", "drivers", "users", ["user_id"], ["id"])
    op.create_foreign_key("fk_drivers_vehicle_id_vehicles", "drivers", "vehicles", ["vehicle_id"], ["id"])
    op.create_unique_constraint("uq_drivers_user_id", "drivers", ["user_id"])
    op.create_index("ix_drivers_status", "drivers", ["status"], unique=False)
    op.create_index("ix_drivers_vehicle_id", "drivers", ["vehicle_id"], unique=False)

    op.add_column("orders", sa.Column("current_offer_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("orders", sa.Column("created_by_source", sa.String(length=50), nullable=True))
    op.add_column("orders", sa.Column("dispatch_started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("orders", sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        "fk_orders_current_offer_id_order_offers", "orders", "order_offers", ["current_offer_id"], ["id"]
    )
    op.create_index("ix_orders_status", "orders", ["status"], unique=False)

    op.add_column("order_offers", sa.Column("sequence_no", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("order_offers", sa.Column("offered_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("order_offers", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("order_offers", sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("order_offers", sa.Column("decision_reason", sa.Text(), nullable=True))
    op.add_column("order_offers", sa.Column("priority_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.create_index("ix_order_offers_status", "order_offers", ["status"], unique=False)
    op.create_index("ix_order_offers_expires_at", "order_offers", ["expires_at"], unique=False)

    op.execute("UPDATE drivers SET status = COALESCE(status, 'offline')")
    op.alter_column("drivers", "status", existing_type=sa.String(length=50), nullable=False, server_default="offline")

    op.execute(
        """
        UPDATE orders
        SET status = CASE
            WHEN status = 'pending' THEN 'searching_driver'
            WHEN status = 'assigned' THEN 'driver_assigned'
            ELSE status
        END
        """
    )
    op.execute("UPDATE orders SET created_by_source = COALESCE(created_by_source, source, 'client_app')")
    op.execute("UPDATE order_offers SET offered_at = created_at WHERE offered_at IS NULL")
    op.alter_column("order_offers", "offered_at", existing_type=sa.DateTime(timezone=True), nullable=False)

    op.alter_column("drivers", "is_auto_dispatch_enabled", server_default=None)
    op.alter_column("drivers", "dispatch_priority", server_default=None)
    op.alter_column("drivers", "status", server_default=None)
    op.alter_column("order_offers", "sequence_no", server_default=None)
    op.alter_column("vehicles", "is_active", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_order_offers_expires_at", table_name="order_offers")
    op.drop_index("ix_order_offers_status", table_name="order_offers")
    op.drop_column("order_offers", "priority_snapshot")
    op.drop_column("order_offers", "decision_reason")
    op.drop_column("order_offers", "responded_at")
    op.drop_column("order_offers", "expires_at")
    op.drop_column("order_offers", "offered_at")
    op.drop_column("order_offers", "sequence_no")

    op.drop_index("ix_orders_status", table_name="orders")
    op.drop_constraint("fk_orders_current_offer_id_order_offers", "orders", type_="foreignkey")
    op.drop_column("orders", "assigned_at")
    op.drop_column("orders", "dispatch_started_at")
    op.drop_column("orders", "created_by_source")
    op.drop_column("orders", "current_offer_id")

    op.drop_index("ix_drivers_vehicle_id", table_name="drivers")
    op.drop_index("ix_drivers_status", table_name="drivers")
    op.drop_constraint("uq_drivers_user_id", "drivers", type_="unique")
    op.drop_constraint("fk_drivers_vehicle_id_vehicles", "drivers", type_="foreignkey")
    op.drop_constraint("fk_drivers_user_id_users", "drivers", type_="foreignkey")
    op.drop_column("drivers", "last_offer_at")
    op.drop_column("drivers", "temporary_penalty_until")
    op.drop_column("drivers", "dispatch_priority")
    op.drop_column("drivers", "is_auto_dispatch_enabled")
    op.drop_column("drivers", "vehicle_id")
    op.drop_column("drivers", "user_id")

    op.drop_table("vehicles")
