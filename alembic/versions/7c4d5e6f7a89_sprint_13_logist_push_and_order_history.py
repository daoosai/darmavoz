
"""sprint 13 logist push and order history

Revision ID: 7c4d5e6f7a89
Revises: 5d6e7f8a9b10
Create Date: 2026-07-06 18:30:00.000000
"""

from __future__ import annotations

import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql import table, column


revision: str = "7c4d5e6f7a89"
down_revision: Union[str, None] = "5d6e7f8a9b10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


STATUS_BY_EVENT_TYPE = {
    "order_created": "created",
    "dispatch_started": "searching_driver",
    "driver_offer_created": "searching_driver",
    "driver_offer_expired": "searching_driver",
    "driver_declined": "searching_driver",
    "driver_cancelled_assigned_order": "searching_driver",
    "no_driver_found": "no_driver_found",
    "driver_assigned": "driver_assigned",
    "driver_assigned_manual": "driver_assigned",
    "driver_accepted_order": "driver_accepted",
    "driver_heading_to_pickup": "heading_to_pickup",
    "driver_arrived_at_pickup": "arrived_at_pickup",
    "driver_loading": "loading",
    "driver_heading_to_client": "heading_to_client",
    "driver_delivered_order": "delivered",
    "driver_completed_order": "completed",
}


order_events_table = table(
    "order_events",
    column("id", postgresql.UUID(as_uuid=True)),
    column("order_id", postgresql.UUID(as_uuid=True)),
    column("status", sa.String(length=50)),
    column("event_type", sa.String(length=100)),
    column("description", sa.Text()),
    column("created_at", sa.DateTime(timezone=True)),
)


def _normalize_status(value: str | None) -> str:
    normalized = (value or "").strip()
    mapping = {
        "pending": "searching_driver",
        "assigned": "driver_assigned",
        "heading_to_quarry": "heading_to_pickup",
        "in_progress": "loading",
        "canceled": "cancelled",
    }
    return mapping.get(normalized, normalized or "created")


def upgrade() -> None:
    op.add_column("users", sa.Column("fcm_token", sa.String(length=1024), nullable=True))
    op.create_table(
        "order_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_order_events_order_id", "order_events", ["order_id"], unique=False)

    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            UPDATE orders
            SET status = CASE
                WHEN status = 'pending' THEN 'searching_driver'
                WHEN status = 'assigned' THEN 'driver_assigned'
                WHEN status = 'heading_to_quarry' THEN 'heading_to_pickup'
                WHEN status = 'in_progress' THEN 'loading'
                WHEN status = 'canceled' THEN 'cancelled'
                ELSE status
            END
            WHERE status IN ('pending', 'assigned', 'heading_to_quarry', 'in_progress', 'canceled')
            """
        )
    )

    order_rows = conn.execute(sa.text("SELECT id, status, created_at FROM orders ORDER BY created_at ASC, id ASC")).mappings().all()
    event_rows = conn.execute(
        sa.text(
            "SELECT order_id, event_type, description, created_at FROM events WHERE order_id IS NOT NULL ORDER BY created_at ASC, id ASC"
        )
    ).mappings().all()

    payload: list[dict] = []
    seen_order_ids: set[uuid.UUID] = set()
    current_status_by_order = {row["id"]: _normalize_status(row["status"]) for row in order_rows}

    for row in event_rows:
        order_id = row["order_id"]
        if order_id is None:
            continue
        seen_order_ids.add(order_id)
        current_status = current_status_by_order.get(order_id, "created")
        payload.append(
            {
                "id": uuid.uuid4(),
                "order_id": order_id,
                "status": STATUS_BY_EVENT_TYPE.get(row["event_type"], current_status),
                "event_type": row["event_type"],
                "description": row["description"],
                "created_at": row["created_at"],
            }
        )

    for row in order_rows:
        if row["id"] in seen_order_ids:
            continue
        payload.append(
            {
                "id": uuid.uuid4(),
                "order_id": row["id"],
                "status": _normalize_status(row["status"]),
                "event_type": "order_state_backfill",
                "description": "Backfilled from current order status during Sprint 13 migration",
                "created_at": row["created_at"],
            }
        )

    if payload:
        op.bulk_insert(order_events_table, payload)


def downgrade() -> None:
    op.drop_index("ix_order_events_order_id", table_name="order_events")
    op.drop_table("order_events")
    op.drop_column("users", "fcm_token")
