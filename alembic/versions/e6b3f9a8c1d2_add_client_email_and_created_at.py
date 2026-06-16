"""Add client email and created_at

Revision ID: e6b3f9a8c1d2
Revises: df3b0b1a2c44
Create Date: 2026-06-06 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e6b3f9a8c1d2"
down_revision: Union[str, None] = "df3b0b1a2c44"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("clients", sa.Column("email", sa.String(length=255), nullable=True))
    op.add_column(
        "clients",
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index(op.f("ix_clients_email"), "clients", ["email"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_clients_email"), table_name="clients")
    op.drop_column("clients", "created_at")
    op.drop_column("clients", "email")
