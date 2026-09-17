import sqlalchemy as sa
"""Seed the hidden Google Play reviewer account.

Revision ID: 936a8b23550f
Revises: s23_parser_material_in_progress
"""
from typing import Sequence, Union
from uuid import UUID

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '936a8b23550f'
down_revision: Union[str, None] = 's23_parser_material_in_progress'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

REVIEWER_PHONE = "+70000000000"
LEGACY_REVIEWER_PHONE = "70000000000"
REVIEWER_USER_ID = UUID("00000000-0000-4000-8000-000000000700")
REVIEWER_PASSWORD_HASH = "$2b$12$ajAGMRXWI601j/eaGst6T.LJ6TttFju6p3sNuBr1bNL29k.apDpM."


def upgrade() -> None:
    bind = op.get_bind()
    reviewer_exists = bind.execute(
        sa.text(
            """
            SELECT 1
            FROM users
            WHERE username IN (:reviewer_phone, :legacy_reviewer_phone)
            LIMIT 1
            """
        ),
        {
            "reviewer_phone": REVIEWER_PHONE,
            "legacy_reviewer_phone": LEGACY_REVIEWER_PHONE,
        },
    ).scalar()
    if reviewer_exists is not None:
        return

    driver_role_id = bind.execute(
        sa.text("SELECT id FROM roles WHERE name = 'driver' LIMIT 1")
    ).scalar()
    if driver_role_id is None:
        raise RuntimeError("Cannot seed Google Play reviewer: driver role is missing")

    bind.execute(
        sa.text(
            """
            INSERT INTO users (
                id,
                username,
                hashed_password,
                role_id,
                is_active,
                is_deleted
            ) VALUES (
                :user_id,
                :reviewer_phone,
                :password_hash,
                :role_id,
                TRUE,
                FALSE
            )
            """
        ),
        {
            "user_id": REVIEWER_USER_ID,
            "reviewer_phone": REVIEWER_PHONE,
            "password_hash": REVIEWER_PASSWORD_HASH,
            "role_id": driver_role_id,
        },
    )


def downgrade() -> None:
    # Reviewer data is intentionally retained when downgrading schema revisions.
    pass
