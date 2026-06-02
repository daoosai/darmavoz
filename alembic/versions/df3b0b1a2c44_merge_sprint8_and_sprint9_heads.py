"""Merge Sprint 8 and Sprint 9 heads

Revision ID: df3b0b1a2c44
Revises: a8b3c1d2e4f5, a9e886c56482
Create Date: 2026-06-02 11:05:00.000000
"""

from typing import Sequence, Union


revision: str = "df3b0b1a2c44"
down_revision: Union[str, tuple[str, str], None] = ("a8b3c1d2e4f5", "a9e886c56482")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
