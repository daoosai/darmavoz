"""Publish cities created before parser auto-publication.

Revision ID: s22_publish_parser_cities
Revises: s22_cities_calculator
"""

from alembic import op


revision = "s22_publish_parser_cities"
down_revision = "s22_cities_calculator"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE cities SET is_active = true WHERE is_active IS NOT TRUE")


def downgrade() -> None:
    # Publication is a deliberate data repair and must not hide cities on rollback.
    pass
