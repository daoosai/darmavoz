"""Join production transport history and the payments/refunds branch.

Production has already applied transport after the reviewer revisions. Staging
has already applied its complete transport schema before them. Preserve the
production ancestry; the transport migration verifies/retains the staging schema.
"""
revision = "release_317_merge_heads"
down_revision = ("refunds_durable_queue", "s23_transport_tariffs")
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
