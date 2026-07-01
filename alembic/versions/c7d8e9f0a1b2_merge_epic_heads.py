"""Merge epic heads

Revision ID: c7d8e9f0a1b2
Revises: 6f0e1d2c3b4a, b9c1d2e3f4a5
Create Date: 2026-07-01 00:20:00.000000
"""

from typing import Sequence, Union


revision: str = "c7d8e9f0a1b2"
down_revision: Union[str, Sequence[str], None] = ("6f0e1d2c3b4a", "b9c1d2e3f4a5")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
