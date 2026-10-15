"""Sprint 25: durable notification delivery. Existing data is preserved."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB
revision = 's25_driver_cities_push'
down_revision = 's24_wholesale_payments'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('push_deliveries',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('dedupe_key', sa.String(255), nullable=False, unique=True),
        sa.Column('recipient_type', sa.String(16), nullable=False),
        sa.Column('recipient_id', UUID(as_uuid=True), nullable=False),
        sa.Column('event_type', sa.String(100), nullable=False),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('payload', JSONB(), nullable=False),
        sa.Column('status', sa.String(16), nullable=False, server_default='pending'),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('next_attempt_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index('ix_push_deliveries_due', 'push_deliveries', ['status', 'next_attempt_at'])

def downgrade():
    raise RuntimeError('Sprint 25 delivery history must be preserved; use a forward migration')
