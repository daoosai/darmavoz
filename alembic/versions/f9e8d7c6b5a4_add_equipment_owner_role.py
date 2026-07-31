"""add equipment owner role

Revision ID: f9e8d7c6b5a4
Revises: f7c2d1e4a9b3
Create Date: 2026-07-30 09:30:00
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "f9e8d7c6b5a4"
down_revision = "f7c2d1e4a9b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO roles (id, name, description)
        SELECT
            '8c9de511-9358-4cf8-8afb-c37a2c6f8c6f'::uuid,
            'equipment_owner',
            'Special equipment owner'
        WHERE NOT EXISTS (
            SELECT 1 FROM roles WHERE name = 'equipment_owner'
        )
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM roles WHERE name = 'equipment_owner'")
