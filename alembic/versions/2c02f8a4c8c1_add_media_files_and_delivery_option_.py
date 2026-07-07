"""add media files and delivery option image

Revision ID: 2c02f8a4c8c1
Revises: 6ca28260f60d
Create Date: 2026-05-23 12:15:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "2c02f8a4c8c1"
down_revision: Union[str, None] = "6ca28260f60d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("delivery_options", sa.Column("image_url", sa.String(length=500), nullable=True))
    op.create_table(
        "media_files",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("entity_type", sa.String(length=50), nullable=False),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("bucket", sa.String(length=255), nullable=False),
        sa.Column("object_key", sa.String(length=1024), nullable=False),
        sa.Column("public_url", sa.String(length=1024), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("object_key"),
    )
    op.create_index(op.f("ix_media_files_entity_id"), "media_files", ["entity_id"], unique=False)
    op.create_index(op.f("ix_media_files_entity_type"), "media_files", ["entity_type"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_media_files_entity_type"), table_name="media_files")
    op.drop_index(op.f("ix_media_files_entity_id"), table_name="media_files")
    op.drop_table("media_files")
    op.drop_column("delivery_options", "image_url")
