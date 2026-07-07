"""sprint 13 order statuses and client fcm

Revision ID: 5d6e7f8a9b10
Revises: c7d8e9f0a1b2
Create Date: 2026-07-06 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "5d6e7f8a9b10"
down_revision: Union[str, None] = "c7d8e9f0a1b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("clients", sa.Column("fcm_token", sa.String(length=1024), nullable=True))
    op.execute(
        sa.text(
            """
            UPDATE orders
            SET status = CASE
                WHEN status = 'heading_to_quarry' THEN 'heading_to_pickup'
                WHEN status = 'in_progress' THEN 'loading'
                ELSE status
            END
            WHERE status IN ('heading_to_quarry', 'in_progress')
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE orders
            SET status = CASE
                WHEN status = 'heading_to_pickup' THEN 'heading_to_quarry'
                WHEN status = 'loading' THEN 'in_progress'
                ELSE status
            END
            WHERE status IN ('heading_to_pickup', 'loading')
            """
        )
    )
    op.drop_column("clients", "fcm_token")
