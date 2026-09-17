"""Restore the explicit in-progress CRM stage for parser material links.

Revision ID: s23_parser_material_in_progress
Revises: s23_transport_tariffs
"""

from alembic import op


revision = "s23_parser_material_in_progress"
down_revision = "s23_transport_tariffs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE crm_status ADD VALUE IF NOT EXISTS 'in_progress'")


def downgrade() -> None:
    # PostgreSQL enum values cannot be safely removed without rewriting every
    # dependent column. The value is harmless for older application versions.
    pass
