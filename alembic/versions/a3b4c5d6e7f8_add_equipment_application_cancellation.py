"""Add client cancellation to equipment applications.

Revision ID: a3b4c5d6e7f8
Revises: f2a3b4c5d6e7
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a3b4c5d6e7f8"
down_revision: Union[str, None] = "f2a3b4c5d6e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "special_equipment_applications",
        sa.Column("cancel_reason", sa.Text(), nullable=True),
    )
    op.drop_constraint(
        "ck_special_equipment_application_status",
        "special_equipment_applications",
        type_="check",
    )
    op.create_check_constraint(
        "ck_special_equipment_application_status",
        "special_equipment_applications",
        "status IN ('new', 'in_progress', 'closed', 'rejected', 'cancelled')",
    )
    op.create_check_constraint(
        "ck_special_equipment_application_cancel_reason",
        "special_equipment_applications",
        "status <> 'cancelled' OR (cancel_reason IS NOT NULL AND btrim(cancel_reason) <> '')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_special_equipment_application_cancel_reason",
        "special_equipment_applications",
        type_="check",
    )
    op.drop_constraint(
        "ck_special_equipment_application_status",
        "special_equipment_applications",
        type_="check",
    )
    op.execute(
        "UPDATE special_equipment_applications SET status = 'closed' WHERE status = 'cancelled'"
    )
    op.create_check_constraint(
        "ck_special_equipment_application_status",
        "special_equipment_applications",
        "status IN ('new', 'in_progress', 'closed', 'rejected')",
    )
    op.drop_column("special_equipment_applications", "cancel_reason")
