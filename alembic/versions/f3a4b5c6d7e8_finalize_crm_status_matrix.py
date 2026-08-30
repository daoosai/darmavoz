"""Finalize CRM statuses for the Sprint 21 visibility matrix.

Revision ID: f3a4b5c6d7e8
Revises: e1f2a3b4c5d6
Create Date: 2026-08-30 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "f3a4b5c6d7e8"
down_revision: Union[str, None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _alter_status_columns(*, new_type: str, mapping: str) -> None:
    for table_name, column_names in {
        "quarries": ("crm_status",),
        "water_points": ("crm_status",),
        "point_audit_log": ("old_status", "new_status"),
    }.items():
        for column_name in column_names:
            if table_name != "point_audit_log" or column_name == "new_status":
                op.execute(
                    f"ALTER TABLE {table_name} ALTER COLUMN {column_name} DROP DEFAULT"
                )
            op.execute(
                f"""
                ALTER TABLE {table_name}
                ALTER COLUMN {column_name} TYPE {new_type}
                USING CASE
                    WHEN {column_name} IS NULL THEN NULL
                    ELSE CASE {column_name}::text
                        {mapping}
                        ELSE 'parsed'
                    END
                END::{new_type}
                """
            )


def upgrade() -> None:
    op.execute("ALTER TYPE crm_status RENAME TO crm_status_legacy")
    op.execute(
        "CREATE TYPE crm_status AS ENUM ('parsed', 'in_progress', 'agreed', 'hidden')"
    )
    _alter_status_columns(
        new_type="crm_status",
        mapping="""
                    WHEN 'parsed' THEN 'parsed'
                    WHEN 'active' THEN 'agreed'
                    WHEN 'rejected' THEN 'hidden'
                    WHEN 'invite_sent' THEN 'in_progress'""",
    )
    op.execute("ALTER TABLE quarries ALTER COLUMN crm_status SET DEFAULT 'agreed'::crm_status")
    op.execute("ALTER TABLE water_points ALTER COLUMN crm_status SET DEFAULT 'agreed'::crm_status")
    op.execute("DROP TYPE crm_status_legacy")


def downgrade() -> None:
    op.execute("ALTER TYPE crm_status RENAME TO crm_status_final")
    op.execute(
        "CREATE TYPE crm_status AS ENUM ('parsed', 'active', 'rejected', 'invite_sent')"
    )
    _alter_status_columns(
        new_type="crm_status",
        mapping="""
                    WHEN 'parsed' THEN 'parsed'
                    WHEN 'agreed' THEN 'active'
                    WHEN 'hidden' THEN 'rejected'
                    WHEN 'in_progress' THEN 'invite_sent'""",
    )
    op.execute("ALTER TABLE quarries ALTER COLUMN crm_status SET DEFAULT 'active'::crm_status")
    op.execute("ALTER TABLE water_points ALTER COLUMN crm_status SET DEFAULT 'active'::crm_status")
    op.execute("DROP TYPE crm_status_final")
