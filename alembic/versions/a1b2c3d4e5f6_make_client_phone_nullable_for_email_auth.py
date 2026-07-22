"""Make client phone nullable for email auth.

Revision ID: a1b2c3d4e5f6
Revises: f6a7b8c9d0e1
Create Date: 2026-07-16 19:30:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "f6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("clients", "phone", existing_type=sa.String(length=20), nullable=True)


def downgrade() -> None:
    op.execute(
        """
        WITH numbered AS (
            SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
            FROM clients
            WHERE phone IS NULL
        )
        UPDATE clients AS c
        SET phone = '+100000' || lpad(numbered.rn::text, 5, '0')
        FROM numbered
        WHERE c.id = numbered.id
        """
    )
    op.alter_column("clients", "phone", existing_type=sa.String(length=20), nullable=False)
