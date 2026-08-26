"""Add invite_sent CRM status.

Revision ID: d6e7f8a9b0c1
Revises: c2e3f4a5b6c7
Create Date: 2026-08-26 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "d6e7f8a9b0c1"
down_revision: Union[str, None] = "c2e3f4a5b6c7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE crm_status ADD VALUE IF NOT EXISTS 'invite_sent'")


def downgrade() -> None:
    # PostgreSQL cannot safely remove a single value from an enum in place.
    pass
