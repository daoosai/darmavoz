"""Normalize any legacy CRM status values left in point tables.

Revision ID: f5b6c7d8e9f0
Revises: f4a5b6c7d8e9
Create Date: 2026-08-30 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "f5b6c7d8e9f0"
down_revision: Union[str, None] = "f4a5b6c7d8e9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for table_name in ("quarries", "water_points"):
        op.execute(
            f"""
            UPDATE {table_name}
            SET crm_status = CASE crm_status::text
                WHEN 'active' THEN 'agreed'
                WHEN 'rejected' THEN 'hidden'
                WHEN 'invite_sent' THEN 'in_progress'
                ELSE crm_status::text
            END::crm_status
            WHERE crm_status::text IN ('active', 'rejected', 'invite_sent')
            """
        )


def downgrade() -> None:
    # The preceding CRM enum migration owns conversion back to legacy values.
    pass
