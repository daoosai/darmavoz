"""merge admin email and client otp heads

Revision ID: e7f8a9b0c1d2
Revises: c8a5e2f1b7d4, d1a2b3c4d5e6
Create Date: 2026-06-22 00:00:00.000000
"""

from typing import Sequence, Union


revision: str = "e7f8a9b0c1d2"
down_revision: Union[str, Sequence[str], None] = ("c8a5e2f1b7d4", "d1a2b3c4d5e6")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
