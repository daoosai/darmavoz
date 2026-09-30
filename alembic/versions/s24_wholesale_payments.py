"""Frozen additive schema for Sprint 24. Financial history is never downgraded implicitly."""
from alembic import op
import sqlalchemy as sa

revision = "s24_wholesale_payments"
down_revision = "de1cd3718448"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("wholesale_access_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.execute("""CREATE TABLE wholesale_requests (
	id UUID NOT NULL,
	author_id UUID NOT NULL,
	city_id UUID NOT NULL,
	material_id UUID,
	material_name VARCHAR(255) NOT NULL,
	volume NUMERIC(14, 3) NOT NULL,
	unit VARCHAR(10) NOT NULL,
	vehicle_count INTEGER NOT NULL,
	pickup_address VARCHAR(500) NOT NULL,
	delivery_address VARCHAR(500) NOT NULL,
	starts_on DATE NOT NULL,
	ends_on DATE NOT NULL,
	price NUMERIC(14, 2) NOT NULL,
	price_basis VARCHAR(20) NOT NULL,
	contact_name VARCHAR(255) NOT NULL,
	contact_phone VARCHAR(30) NOT NULL,
	comment TEXT,
	status VARCHAR(32) NOT NULL,
	moderation_reason TEXT,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT ck_wholesale_positive CHECK (volume > 0 AND vehicle_count > 0 AND price > 0),
	CONSTRAINT ck_wholesale_dates CHECK (ends_on >= starts_on),
	FOREIGN KEY(author_id) REFERENCES users (id),
	FOREIGN KEY(city_id) REFERENCES cities (id),
	FOREIGN KEY(material_id) REFERENCES materials (id)
)""")
    op.execute("""CREATE INDEX ix_wholesale_requests_author_id ON wholesale_requests (author_id)""")
    op.execute("""CREATE INDEX ix_wholesale_requests_city_id ON wholesale_requests (city_id)""")
    op.execute("""CREATE INDEX ix_wholesale_requests_ends_on ON wholesale_requests (ends_on)""")
    op.execute("""CREATE INDEX ix_wholesale_requests_status ON wholesale_requests (status)""")
    op.execute("""CREATE TABLE wholesale_favorites (
	user_id UUID NOT NULL,
	request_id UUID NOT NULL,
	enabled BOOLEAN NOT NULL,
	PRIMARY KEY (user_id, request_id),
	FOREIGN KEY(user_id) REFERENCES users (id),
	FOREIGN KEY(request_id) REFERENCES wholesale_requests (id)
)""")
    op.execute("""CREATE TABLE wholesale_events (
	id UUID NOT NULL,
	request_id UUID NOT NULL,
	actor_id UUID,
	status VARCHAR(32) NOT NULL,
	reason TEXT,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(request_id) REFERENCES wholesale_requests (id),
	FOREIGN KEY(actor_id) REFERENCES users (id)
)""")
    op.execute("""CREATE INDEX ix_wholesale_events_request_id ON wholesale_events (request_id)""")
    op.execute("""CREATE TABLE payment_quotes (
	id UUID NOT NULL,
	order_id UUID NOT NULL,
	version INTEGER NOT NULL,
	is_valid BOOLEAN DEFAULT 'true' NOT NULL,
	amount NUMERIC(14, 2) NOT NULL,
	items JSONB NOT NULL,
	confirmed_by UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (order_id, version),
	CONSTRAINT ck_quote_amount CHECK (amount > 0),
	FOREIGN KEY(order_id) REFERENCES orders (id),
	FOREIGN KEY(confirmed_by) REFERENCES users (id)
)""")
    op.execute("""CREATE INDEX ix_payment_quotes_order_id ON payment_quotes (order_id)""")
    op.execute("""CREATE TABLE payments (
	id UUID NOT NULL,
	order_id UUID NOT NULL,
	client_id UUID NOT NULL,
	quote_id UUID NOT NULL,
	amount NUMERIC(14, 2) NOT NULL,
	currency VARCHAR(3) NOT NULL,
	provider_id VARCHAR(100),
	idempotence_key VARCHAR(64) NOT NULL,
	status VARCHAR(32) NOT NULL,
	provider_status VARCHAR(32),
	payment_method VARCHAR(50),
	confirmation_url TEXT,
	receipt_status VARCHAR(32),
	refund_status VARCHAR(32),
	needs_review BOOLEAN DEFAULT 'false' NOT NULL,
	failure_reason VARCHAR(255),
	customer_contact JSONB NOT NULL,
	request_body JSONB NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	paid_at TIMESTAMP WITH TIME ZONE,
	checked_at TIMESTAMP WITH TIME ZONE,
	reconciliation_status VARCHAR(32),
	PRIMARY KEY (id),
	CONSTRAINT ck_payment_amount CHECK (amount > 0),
	FOREIGN KEY(order_id) REFERENCES orders (id),
	FOREIGN KEY(client_id) REFERENCES clients (id),
	FOREIGN KEY(quote_id) REFERENCES payment_quotes (id),
	UNIQUE (provider_id),
	UNIQUE (idempotence_key)
)""")
    op.execute("""CREATE INDEX ix_payments_client_id ON payments (client_id)""")
    op.execute("""CREATE INDEX ix_payments_created_at ON payments (created_at)""")
    op.execute("""CREATE INDEX ix_payments_order_id ON payments (order_id)""")
    op.execute("""CREATE INDEX ix_payments_paid_at ON payments (paid_at)""")
    op.execute("""CREATE INDEX ix_payments_status ON payments (status)""")
    op.execute("""CREATE UNIQUE INDEX uq_payment_order_active ON payments (order_id) WHERE status IN ('creating', 'unknown', 'pending', 'succeeded')""")
    op.execute("""CREATE TABLE payment_events (
	id UUID NOT NULL,
	payment_id UUID NOT NULL,
	event_type VARCHAR(80) NOT NULL,
	description TEXT NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(payment_id) REFERENCES payments (id)
)""")
    op.execute("""CREATE INDEX ix_payment_events_payment_id ON payment_events (payment_id)""")
    op.execute("""CREATE TABLE payment_refunds (
	id UUID NOT NULL,
	payment_id UUID NOT NULL,
	amount NUMERIC(14, 2) NOT NULL,
	provider_id VARCHAR(100),
	idempotence_key VARCHAR(64) NOT NULL,
	initiated_by UUID,
	reason TEXT NOT NULL,
	request_body JSONB NOT NULL,
	status VARCHAR(32) NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	refunded_at TIMESTAMP WITH TIME ZONE,
	PRIMARY KEY (id),
	FOREIGN KEY(payment_id) REFERENCES payments (id),
	UNIQUE (provider_id),
	UNIQUE (idempotence_key),
	FOREIGN KEY(initiated_by) REFERENCES users (id)
)""")
    op.execute("""CREATE INDEX ix_payment_refunds_payment_id ON payment_refunds (payment_id)""")
    op.execute("""CREATE INDEX ix_payment_refunds_refunded_at ON payment_refunds (refunded_at)""")
    op.execute("""CREATE UNIQUE INDEX uq_refund_active ON payment_refunds (payment_id) WHERE status IN ('creating', 'unknown', 'pending', 'succeeded')""")
    op.execute("""CREATE TABLE settlement_receipts (
	id UUID NOT NULL,
	payment_id UUID NOT NULL,
	idempotence_key VARCHAR(64) NOT NULL,
	provider_id VARCHAR(100),
	status VARCHAR(32) NOT NULL,
	request_body JSONB NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (payment_id),
	FOREIGN KEY(payment_id) REFERENCES payments (id),
	UNIQUE (idempotence_key)
)""")


def downgrade():
    raise RuntimeError("Financial history requires a separately reviewed destructive migration")
