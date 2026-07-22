"""Add rejection details to equipment applications.

Revision ID: f2a3b4c5d6e7
Revises: e15a2b3c4d5f
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f2a3b4c5d6e7"
down_revision: Union[str, None] = "e15a2b3c4d5f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "special_equipment_applications",
        sa.Column("reject_reason", sa.Text(), nullable=True),
    )
    op.drop_constraint(
        "ck_special_equipment_application_status",
        "special_equipment_applications",
        type_="check",
    )
    op.create_check_constraint(
        "ck_special_equipment_application_status",
        "special_equipment_applications",
        "status IN ('new', 'in_progress', 'closed', 'rejected')",
    )
    op.create_check_constraint(
        "ck_special_equipment_application_reject_reason",
        "special_equipment_applications",
        "status <> 'rejected' OR (reject_reason IS NOT NULL AND btrim(reject_reason) <> '')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_special_equipment_application_reject_reason",
        "special_equipment_applications",
        type_="check",
    )
    op.drop_constraint(
        "ck_special_equipment_application_status",
        "special_equipment_applications",
        type_="check",
    )
    op.execute(
        "UPDATE special_equipment_applications SET status = 'closed' WHERE status = 'rejected'"
    )
    op.create_check_constraint(
        "ck_special_equipment_application_status",
        "special_equipment_applications",
        "status IN ('new', 'in_progress', 'closed')",
    )
    op.drop_column("special_equipment_applications", "reject_reason")
