"""add quantity to order_items

Revision ID: 21f5334b7d4f
Revises: 2c02f8a4c8c1
Create Date: 2026-05-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "21f5334b7d4f"
down_revision: Union[str, None] = "2c02f8a4c8c1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "order_items",
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
    )
    op.alter_column("order_items", "quantity", server_default=None)


def downgrade() -> None:
    op.drop_column("order_items", "quantity")
