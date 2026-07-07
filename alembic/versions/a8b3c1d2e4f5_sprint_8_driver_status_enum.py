"""Sprint 8: driver status enum

Revision ID: a8b3c1d2e4f5
Revises: 2c02f8a4c8c1
Create Date: 2026-05-29 02:45:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a8b3c1d2e4f5"
down_revision: Union[str, None] = "21f5334b7d4f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


driver_status_enum = sa.Enum("available", "busy", "offline", name="driver_status")


def upgrade() -> None:
    bind = op.get_bind()
    driver_status_enum.create(bind, checkfirst=True)

    op.execute(
        """
        UPDATE drivers
        SET status = CASE
            WHEN status IN ('available', 'busy', 'offline') THEN status
            ELSE 'offline'
        END
        """
    )
    op.alter_column(
        "drivers",
        "status",
        existing_type=sa.String(length=50),
        type_=driver_status_enum,
        existing_nullable=True,
        nullable=False,
        postgresql_using="status::driver_status",
        server_default="offline",
    )


def downgrade() -> None:
    op.alter_column(
        "drivers",
        "status",
        existing_type=driver_status_enum,
        type_=sa.String(length=50),
        existing_nullable=False,
        nullable=True,
        postgresql_using="status::text",
        server_default=None,
    )
    bind = op.get_bind()
    driver_status_enum.drop(bind, checkfirst=True)
