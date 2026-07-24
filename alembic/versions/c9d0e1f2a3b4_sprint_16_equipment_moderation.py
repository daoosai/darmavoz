"""Add custom equipment types, ownership, and moderation.

Revision ID: c9d0e1f2a3b4
Revises: b2c3d4e5f6a7
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "c9d0e1f2a3b4"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


moderation_status_enum = postgresql.ENUM(
    "incomplete",
    "pending_moderation",
    "approved",
    "rejected",
    "suspended",
    name="moderation_status",
    create_type=False,
)


def upgrade() -> None:
    op.add_column(
        "special_equipment_listings",
        sa.Column("equipment_type", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "special_equipment_listings",
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "special_equipment_listings",
        sa.Column(
            "moderation_status",
            moderation_status_enum,
            nullable=False,
            server_default=sa.text("'approved'::moderation_status"),
        ),
    )
    op.add_column(
        "special_equipment_listings",
        sa.Column("moderation_comment", sa.Text(), nullable=True),
    )
    op.add_column(
        "special_equipment_listings",
        sa.Column("moderated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "special_equipment_listings",
        sa.Column("moderated_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )

    op.execute(
        """
        UPDATE special_equipment_listings AS listing
        SET equipment_type = equipment_type.name
        FROM special_equipment_types AS equipment_type
        WHERE equipment_type.id = listing.equipment_type_id
        """
    )
    op.alter_column(
        "special_equipment_listings",
        "equipment_type",
        existing_type=sa.String(length=255),
        nullable=False,
    )
    op.alter_column(
        "special_equipment_listings",
        "equipment_type_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )
    op.execute(
        """
        UPDATE special_equipment_listings AS listing
        SET owner_user_id = listing.created_by_user_id
        FROM users AS owner_user
        JOIN roles AS owner_role ON owner_role.id = owner_user.role_id
        WHERE owner_user.id = listing.created_by_user_id
          AND owner_role.name = 'supplier'
        """
    )
    op.alter_column(
        "special_equipment_listings",
        "moderation_status",
        existing_type=moderation_status_enum,
        nullable=False,
        server_default=sa.text("'pending_moderation'::moderation_status"),
    )

    op.create_foreign_key(
        "fk_special_equipment_listings_owner_user_id",
        "special_equipment_listings",
        "users",
        ["owner_user_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_special_equipment_listings_moderated_by_user_id",
        "special_equipment_listings",
        "users",
        ["moderated_by_user_id"],
        ["id"],
    )
    op.create_index(
        "ix_special_equipment_listings_equipment_type",
        "special_equipment_listings",
        ["equipment_type"],
    )
    op.create_index(
        "ix_special_equipment_listings_owner_user_id",
        "special_equipment_listings",
        ["owner_user_id"],
    )
    op.create_index(
        "ix_special_equipment_listings_moderation_status",
        "special_equipment_listings",
        ["moderation_status"],
    )


def downgrade() -> None:
    # Recreate dictionary rows for custom values before restoring the mandatory FK.
    op.execute(
        """
        UPDATE special_equipment_listings AS listing
        SET equipment_type_id = equipment_type.id
        FROM special_equipment_types AS equipment_type
        WHERE listing.equipment_type_id IS NULL
          AND lower(btrim(equipment_type.name)) = lower(btrim(listing.equipment_type))
        """
    )
    op.execute(
        """
        INSERT INTO special_equipment_types (
            id,
            name,
            slug,
            sort_order,
            is_active,
            created_at,
            updated_at
        )
        SELECT
            (
                substr(md5('sprint16:' || source.equipment_type), 1, 8) || '-' ||
                substr(md5('sprint16:' || source.equipment_type), 9, 4) || '-' ||
                substr(md5('sprint16:' || source.equipment_type), 13, 4) || '-' ||
                substr(md5('sprint16:' || source.equipment_type), 17, 4) || '-' ||
                substr(md5('sprint16:' || source.equipment_type), 21, 12)
            )::uuid,
            source.equipment_type,
            'legacy-' || md5(lower(btrim(source.equipment_type))),
            0,
            TRUE,
            now(),
            now()
        FROM (
            SELECT min(equipment_type) AS equipment_type
            FROM special_equipment_listings
            WHERE equipment_type_id IS NULL
            GROUP BY lower(btrim(equipment_type))
        ) AS source
        WHERE NOT EXISTS (
            SELECT 1
            FROM special_equipment_types AS existing
            WHERE lower(btrim(existing.name)) = lower(btrim(source.equipment_type))
        )
        """
    )
    op.execute(
        """
        UPDATE special_equipment_listings AS listing
        SET equipment_type_id = equipment_type.id
        FROM special_equipment_types AS equipment_type
        WHERE listing.equipment_type_id IS NULL
          AND lower(btrim(equipment_type.name)) = lower(btrim(listing.equipment_type))
        """
    )
    op.alter_column(
        "special_equipment_listings",
        "equipment_type_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )

    op.drop_index(
        "ix_special_equipment_listings_moderation_status",
        table_name="special_equipment_listings",
    )
    op.drop_index(
        "ix_special_equipment_listings_owner_user_id",
        table_name="special_equipment_listings",
    )
    op.drop_index(
        "ix_special_equipment_listings_equipment_type",
        table_name="special_equipment_listings",
    )
    op.drop_constraint(
        "fk_special_equipment_listings_moderated_by_user_id",
        "special_equipment_listings",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_special_equipment_listings_owner_user_id",
        "special_equipment_listings",
        type_="foreignkey",
    )
    op.drop_column("special_equipment_listings", "moderated_by_user_id")
    op.drop_column("special_equipment_listings", "moderated_at")
    op.drop_column("special_equipment_listings", "moderation_comment")
    op.drop_column("special_equipment_listings", "moderation_status")
    op.drop_column("special_equipment_listings", "owner_user_id")
    op.drop_column("special_equipment_listings", "equipment_type")
