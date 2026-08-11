"""add water and septic partner role

Revision ID: a0f6e2c4b8d1
Revises: c0a1b2c3d4e5
Create Date: 2026-08-10 18:30:00.000000

"""

from typing import Sequence, Union

from alembic import op


revision: str = "a0f6e2c4b8d1"
down_revision: Union[str, None] = "c0a1b2c3d4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Roles are stored in the roles table in this project, not in a PostgreSQL ENUM.
    # The insert is idempotent so it is safe for databases that were seeded earlier.
    op.execute(
        """
        INSERT INTO roles (id, name, description)
        SELECT
            '0d47a83a-949f-4651-a6f7-b02839204b7a'::uuid,
            'water_septic_partner',
            'Water points and septic services partner'
        WHERE NOT EXISTS (
            SELECT 1 FROM roles WHERE name = 'water_septic_partner'
        )
        """
    )


def downgrade() -> None:
    # Do not delete the role automatically: it may already be assigned to users.
    pass
