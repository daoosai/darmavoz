"""Allow unspecified transport count without inventing a number of vehicles."""
from alembic import op
import sqlalchemy as sa

revision = "s24_wholesale_optional_vehicles"
down_revision = "s24_wholesale_moderation_cycle"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("wholesale_requests", "vehicle_count", existing_type=sa.Integer(), nullable=True)


def downgrade():
    # A missing count cannot be truthfully converted to a mandatory positive count.
    raise RuntimeError("Unspecified vehicle counts must be preserved; use a forward migration")
