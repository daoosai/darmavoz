"""approve_google_reviewer_and_add_vehicle

Revision ID: de1cd3718448
Revises: 936a8b23550f
Create Date: 2026-09-18 09:08:09.961283

"""
from typing import Sequence, Union
from uuid import UUID

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'de1cd3718448'
down_revision: Union[str, None] = '936a8b23550f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

REVIEWER_PHONE = "+70000000000"
LEGACY_REVIEWER_PHONE = "70000000000"
REVIEWER_DRIVER_ID = UUID("00000000-0000-4000-8000-000000000702")
REVIEWER_VEHICLE_ID = UUID("00000000-0000-4000-8000-000000000703")


def _reviewer_vehicle_values() -> dict[str, object]:
    return {
        "title": "Камаз А000АА72",
        "brand": "Камаз",
        "plate_number": "А000АА72",
        "vehicle_type": "Самосвал",
        "body_volume_m3": 20,
        "cubature_min": 20,
        "cubature_max": 20,
        "notes": "Google Play reviewer test vehicle",
    }


def upgrade() -> None:
    bind = op.get_bind()
    user_id = bind.execute(
        sa.text(
            """
            SELECT id
            FROM users
            WHERE username IN (:reviewer_phone, :legacy_reviewer_phone)
            ORDER BY (username = :reviewer_phone) DESC
            LIMIT 1
            """
        ),
        {
            "reviewer_phone": REVIEWER_PHONE,
            "legacy_reviewer_phone": LEGACY_REVIEWER_PHONE,
        },
    ).scalar()
    if user_id is None:
        # The preceding reviewer-account migration was not applied in this database.
        return

    driver = bind.execute(
        sa.text(
            """
            SELECT id, vehicle_id
            FROM drivers
            WHERE user_id = :user_id
            LIMIT 1
            """
        ),
        {"user_id": user_id},
    ).mappings().first()
    if driver is None:
        driver = bind.execute(
            sa.text(
                """
                SELECT id, vehicle_id
                FROM drivers
                WHERE phone IN (:reviewer_phone, :legacy_reviewer_phone)
                LIMIT 1
                """
            ),
            {
                "reviewer_phone": REVIEWER_PHONE,
                "legacy_reviewer_phone": LEGACY_REVIEWER_PHONE,
            },
        ).mappings().first()

    vehicle_id = driver["vehicle_id"] if driver and driver["vehicle_id"] else REVIEWER_VEHICLE_ID
    vehicle_values = {"vehicle_id": vehicle_id, **_reviewer_vehicle_values()}
    vehicle_exists = bind.execute(
        sa.text("SELECT 1 FROM vehicles WHERE id = :vehicle_id"),
        {"vehicle_id": vehicle_id},
    ).scalar()
    if vehicle_exists is None:
        bind.execute(
            sa.text(
                """
                INSERT INTO vehicles (
                    id, title, brand, plate_number, vehicle_type,
                    body_volume_m3, cubature_min, cubature_max,
                    is_active, notes, moderation_status, moderated_at
                ) VALUES (
                    :vehicle_id, :title, :brand, :plate_number, :vehicle_type,
                    :body_volume_m3, :cubature_min, :cubature_max,
                    TRUE, :notes, 'approved', CURRENT_TIMESTAMP
                )
                """
            ),
            vehicle_values,
        )
    else:
        bind.execute(
            sa.text(
                """
                UPDATE vehicles
                SET title = :title,
                    brand = :brand,
                    plate_number = :plate_number,
                    vehicle_type = :vehicle_type,
                    body_volume_m3 = :body_volume_m3,
                    cubature_min = :cubature_min,
                    cubature_max = :cubature_max,
                    is_active = TRUE,
                    notes = :notes,
                    moderation_status = 'approved',
                    moderation_comment = NULL,
                    moderated_at = CURRENT_TIMESTAMP,
                    moderated_by_user_id = NULL
                WHERE id = :vehicle_id
                """
            ),
            vehicle_values,
        )

    if driver is None:
        bind.execute(
            sa.text(
                """
                INSERT INTO drivers (
                    id, name, phone, user_id, vehicle_id, status,
                    is_active, is_on_shift, is_auto_dispatch_enabled,
                    dispatch_priority, rating, is_dispatch_eligible,
                    dispatch_admission_score, moderation_status, moderated_at
                ) VALUES (
                    :driver_id, 'Google Play Reviewer', :reviewer_phone,
                    :user_id, :vehicle_id, 'offline',
                    TRUE, FALSE, TRUE,
                    100, 5.0, TRUE,
                    100, 'approved', CURRENT_TIMESTAMP
                )
                """
            ),
            {
                "driver_id": REVIEWER_DRIVER_ID,
                "reviewer_phone": REVIEWER_PHONE,
                "user_id": user_id,
                "vehicle_id": vehicle_id,
            },
        )
    else:
        bind.execute(
            sa.text(
                """
                UPDATE drivers
                SET name = 'Google Play Reviewer',
                    phone = :reviewer_phone,
                    user_id = :user_id,
                    vehicle_id = :vehicle_id,
                    status = 'offline',
                    is_active = TRUE,
                    is_on_shift = FALSE,
                    is_auto_dispatch_enabled = TRUE,
                    dispatch_priority = 100,
                    rating = 5.0,
                    is_dispatch_eligible = TRUE,
                    dispatch_admission_score = 100,
                    moderation_status = 'approved',
                    moderation_comment = NULL,
                    moderated_at = CURRENT_TIMESTAMP,
                    moderated_by_user_id = NULL
                WHERE id = :driver_id
                """
            ),
            {
                "driver_id": driver["id"],
                "reviewer_phone": REVIEWER_PHONE,
                "user_id": user_id,
                "vehicle_id": vehicle_id,
            },
        )


def downgrade() -> None:
    # Reviewer data is intentionally retained when downgrading schema revisions.
    pass
