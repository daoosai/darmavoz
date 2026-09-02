"""Expand the CRM status funnel for parsed points.

Revision ID: a0b1c2d3e4f5
Revises: f5b6c7d8e9f0
Create Date: 2026-09-02 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "a0b1c2d3e4f5"
down_revision: Union[str, None] = "f5b6c7d8e9f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


CRM_STATUS_COLUMNS = {
    "quarries": ("crm_status",),
    "water_points": ("crm_status",),
    "point_audit_log": ("old_status", "new_status"),
}


def _replace_crm_status_type(*, new_values: str, legacy_type: str, mapping: str, default: str) -> None:
    op.execute(f"ALTER TYPE crm_status RENAME TO {legacy_type}")
    op.execute(f"CREATE TYPE crm_status AS ENUM ({new_values})")

    for table_name, column_names in CRM_STATUS_COLUMNS.items():
        for column_name in column_names:
            op.execute(f"ALTER TABLE {table_name} ALTER COLUMN {column_name} DROP DEFAULT")
            op.execute(
                f"""
                ALTER TABLE {table_name}
                ALTER COLUMN {column_name} TYPE crm_status
                USING CASE
                    WHEN {column_name} IS NULL THEN NULL
                    ELSE CASE {column_name}::text
                        {mapping}
                        ELSE '{default}'
                    END
                END::crm_status
                """
            )

    op.execute(f"ALTER TABLE quarries ALTER COLUMN crm_status SET DEFAULT '{default}'::crm_status")
    op.execute(f"ALTER TABLE water_points ALTER COLUMN crm_status SET DEFAULT '{default}'::crm_status")
    op.execute(f"DROP TYPE {legacy_type}")


def upgrade() -> None:
    _replace_crm_status_type(
        new_values="'auto_added', 'invite_sent', 'response_received', 'interested', 'registered', 'registration_completed', 'activated', 'refused', 'call_later'",
        legacy_type="crm_status_legacy",
        mapping="""
                    WHEN 'parsed' THEN 'auto_added'
                    WHEN 'in_progress' THEN 'invite_sent'
                    WHEN 'agreed' THEN 'activated'
                    WHEN 'hidden' THEN 'refused'""",
        default="activated",
    )


def downgrade() -> None:
    _replace_crm_status_type(
        new_values="'parsed', 'in_progress', 'agreed', 'hidden'",
        legacy_type="crm_status_funnel_legacy",
        mapping="""
                    WHEN 'auto_added' THEN 'parsed'
                    WHEN 'activated' THEN 'agreed'
                    WHEN 'refused' THEN 'hidden'
                    WHEN 'invite_sent' THEN 'in_progress'
                    WHEN 'response_received' THEN 'in_progress'
                    WHEN 'interested' THEN 'in_progress'
                    WHEN 'registered' THEN 'in_progress'
                    WHEN 'registration_completed' THEN 'in_progress'
                    WHEN 'call_later' THEN 'in_progress'""",
        default="agreed",
    )
