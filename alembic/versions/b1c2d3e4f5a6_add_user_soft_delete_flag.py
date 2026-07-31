"""add user soft delete flag

Revision ID: b1c2d3e4f5a6
Revises: a7c1d9e4f2b3
Create Date: 2026-07-31 14:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "b1c2d3e4f5a6"
down_revision = "a7c1d9e4f2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "is_deleted",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_index(op.f("ix_users_is_deleted"), "users", ["is_deleted"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_users_is_deleted"), table_name="users")
    op.drop_column("users", "is_deleted")
