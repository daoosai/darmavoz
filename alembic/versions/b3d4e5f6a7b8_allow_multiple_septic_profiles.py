"""allow multiple septic profiles per equipment owner

Revision ID: b3d4e5f6a7b8
Revises: d2cf4113ada7
Create Date: 2026-08-10 13:30:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "b3d4e5f6a7b8"
down_revision: Union[str, None] = "d2cf4113ada7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint(
        "septic_provider_profiles_owner_user_id_key",
        "septic_provider_profiles",
        type_="unique",
    )
    op.create_index(
        "ix_septic_provider_profiles_owner_user_id",
        "septic_provider_profiles",
        ["owner_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_septic_provider_profiles_owner_user_id",
        table_name="septic_provider_profiles",
    )
    op.create_unique_constraint(
        "septic_provider_profiles_owner_user_id_key",
        "septic_provider_profiles",
        ["owner_user_id"],
    )
