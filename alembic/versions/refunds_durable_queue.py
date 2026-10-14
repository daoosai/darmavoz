"""Durable refunds, partial refunds and cancellation obligations. No legacy auto-refunds."""
from alembic import op
import sqlalchemy as sa

revision = "refunds_durable_queue"
down_revision = "s24_wholesale_drafts"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("payments", sa.Column("auto_refund_requested", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("payments", sa.Column("cancel_idempotence_key", sa.String(64)))
    op.add_column("payment_refunds", sa.Column("request_id", sa.UUID()))
    op.create_unique_constraint("uq_refund_request_id", "payment_refunds", ["request_id"])
    op.add_column("payment_refunds", sa.Column("origin", sa.String(24), nullable=False, server_default="manual"))
    op.add_column("payment_refunds", sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("payment_refunds", sa.Column("first_attempt_at", sa.DateTime(timezone=True)))
    op.add_column("payment_refunds", sa.Column("next_attempt_at", sa.DateTime(timezone=True)))
    op.add_column("payment_refunds", sa.Column("last_error", sa.String(255)))
    op.create_index("ix_payment_refunds_next_attempt_at", "payment_refunds", ["next_attempt_at"])
    op.execute("UPDATE payment_refunds SET first_attempt_at = created_at WHERE status IN ('creating','unknown','pending')")
    op.drop_index("uq_refund_active", table_name="payment_refunds")
    op.create_index("uq_refund_active", "payment_refunds", ["payment_id"], unique=True,
                    postgresql_where=sa.text("status IN ('queued','creating','unknown','pending','manual_review')"))
    op.create_check_constraint("ck_refund_amount", "payment_refunds", "amount > 0")


def downgrade():
    raise RuntimeError("Financial records must be preserved; use a forward migration")
