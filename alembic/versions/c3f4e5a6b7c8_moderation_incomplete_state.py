"""add incomplete moderation state

Revision ID: c3f4e5a6b7c8
Revises: 9f1c2b7d4e11
Create Date: 2026-06-18 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "c3f4e5a6b7c8"
down_revision: Union[str, None] = "9f1c2b7d4e11"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_enum
                WHERE enumlabel = 'incomplete'
                  AND enumtypid = 'moderation_status'::regtype
            ) THEN
                ALTER TYPE moderation_status ADD VALUE 'incomplete' BEFORE 'pending_moderation';
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    # PostgreSQL enums do not support dropping values safely in-place.
    pass
