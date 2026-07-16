"""Add attachment_url to support messages.

Revision ID: e4f5a6b7c8d9
Revises: d8e9f0a1b2c3
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e4f5a6b7c8d9"
down_revision: Union[str, None] = "d8e9f0a1b2c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "support_messages",
        sa.Column("attachment_url", sa.String(length=1024), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("support_messages", "attachment_url")
