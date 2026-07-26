"""allow nullable coords for supplier points

Revision ID: e9f1a2b3c4d5
Revises: c9d0e1f2a3b4
Create Date: 2026-07-26 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "e9f1a2b3c4d5"
down_revision = "c9d0e1f2a3b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("quarries", "lat", existing_type=sa.Float(), nullable=True)
    op.alter_column("quarries", "lon", existing_type=sa.Float(), nullable=True)


def downgrade() -> None:
    op.alter_column("quarries", "lon", existing_type=sa.Float(), nullable=False)
    op.alter_column("quarries", "lat", existing_type=sa.Float(), nullable=False)
