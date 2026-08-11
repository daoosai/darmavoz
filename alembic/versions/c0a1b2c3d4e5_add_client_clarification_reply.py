"""add client clarification reply to orders

Revision ID: c0a1b2c3d4e5
Revises: b3d4e5f6a7b8
Create Date: 2026-08-10 15:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "c0a1b2c3d4e5"
down_revision: Union[str, None] = "b3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column("client_clarification_reply", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("orders", "client_clarification_reply")
