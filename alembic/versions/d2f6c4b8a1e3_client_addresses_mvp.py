"""client addresses mvp

Revision ID: d2f6c4b8a1e3
Revises: b7d9e2c4a1f0
Create Date: 2026-06-19 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "d2f6c4b8a1e3"
down_revision: Union[str, None] = "b7d9e2c4a1f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "client_addresses",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("full_address", sa.String(length=500), nullable=False),
        sa.Column("city", sa.String(length=255), nullable=True),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lon", sa.Float(), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_client_addresses_client_id"), "client_addresses", ["client_id"], unique=False)
    op.alter_column("client_addresses", "is_default", server_default=None)


def downgrade() -> None:
    op.drop_index(op.f("ix_client_addresses_client_id"), table_name="client_addresses")
    op.drop_table("client_addresses")
