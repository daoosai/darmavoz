"""sprint 10 media slots and primary rules

Revision ID: 8d4a1c2d5b61
Revises: e6b3f9a8c1d2
Create Date: 2026-06-10 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "8d4a1c2d5b61"
down_revision: Union[str, None] = "e6b3f9a8c1d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("media_files", sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("media_files", sa.Column("slot_key", sa.String(length=50), nullable=True))
    op.execute("update media_files set sort_order = 0 where sort_order is null")
    op.alter_column("media_files", "sort_order", server_default=None)

    op.create_index(
        "uq_media_files_primary_per_entity",
        "media_files",
        ["entity_type", "entity_id"],
        unique=True,
        postgresql_where=sa.text("is_primary = true"),
    )
    op.create_index(
        "uq_media_files_slot_per_entity",
        "media_files",
        ["entity_type", "entity_id", "slot_key"],
        unique=True,
        postgresql_where=sa.text("slot_key is not null"),
    )


def downgrade() -> None:
    op.drop_index("uq_media_files_slot_per_entity", table_name="media_files")
    op.drop_index("uq_media_files_primary_per_entity", table_name="media_files")
    op.drop_column("media_files", "slot_key")
    op.drop_column("media_files", "sort_order")
