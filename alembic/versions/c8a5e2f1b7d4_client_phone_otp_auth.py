"""client phone otp auth

Revision ID: c8a5e2f1b7d4
Revises: f4b0c7d9e2a1
Create Date: 2026-06-19 11:50:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "c8a5e2f1b7d4"
down_revision: Union[str, None] = "f4b0c7d9e2a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
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


def downgrade() -> None:
    op.alter_column("clients", "phone", existing_type=sa.String(length=20), nullable=True)
