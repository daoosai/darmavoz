"""Add private wholesale drafts without changing existing request states."""
from alembic import op

revision = "s24_wholesale_drafts"
down_revision = "s24_wholesale_optional_vehicles"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint("ck_wholesale_status", "wholesale_requests", type_="check")
    op.create_check_constraint("ck_wholesale_status", "wholesale_requests",
                               "status IN ('draft', 'pending', 'approved', 'rejected', 'archived')")


def downgrade():
    raise RuntimeError("Private drafts must be preserved; use a forward migration")
