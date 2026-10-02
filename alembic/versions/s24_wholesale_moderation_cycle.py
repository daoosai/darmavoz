"""Canonical wholesale moderation states; preserve requests and audit history."""
from alembic import op
import sqlalchemy as sa

revision = "s24_wholesale_moderation_cycle"
down_revision = "s25_driver_cities_push"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("wholesale_requests", "moderation_reason", new_column_name="reject_reason")
    for table in ("wholesale_requests", "wholesale_events"):
        op.execute(sa.text(f"""
            UPDATE {table} SET status = CASE status
              WHEN 'draft' THEN 'pending' WHEN 'pending_moderation' THEN 'pending'
              WHEN 'published' THEN 'approved' WHEN 'closed' THEN 'archived'
              WHEN 'hidden' THEN 'archived' ELSE status END
        """))
    op.execute("UPDATE wholesale_requests SET reject_reason = NULL WHERE status != 'rejected'")
    op.execute("UPDATE wholesale_requests SET reject_reason = 'Причина не сохранена в прежней версии. Исправьте заявку и отправьте снова.' WHERE status = 'rejected' AND (reject_reason IS NULL OR trim(reject_reason) = '')")
    op.alter_column("wholesale_requests", "status", server_default="pending")
    op.create_check_constraint("ck_wholesale_status", "wholesale_requests", "status IN ('pending','approved','rejected','archived')")
    op.create_check_constraint("ck_wholesale_reject_reason", "wholesale_requests", "status != 'rejected' OR (reject_reason IS NOT NULL AND length(trim(reject_reason)) > 0)")


def downgrade():
    raise RuntimeError("Moderation and delivery history must be preserved; use a forward migration")
