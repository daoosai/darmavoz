import asyncio
from collections.abc import Sequence

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings


def _count_rows(rows: Sequence[object]) -> int:
    return len(rows)


async def main() -> None:
    engine = create_async_engine(settings.DATABASE_URL, echo=False)

    try:
        async with engine.begin() as conn:
            user_result = await conn.execute(
                text(
                    """
                    UPDATE users
                    SET is_active = TRUE
                    WHERE id IN (
                        SELECT user_id
                        FROM drivers
                        WHERE user_id IS NOT NULL
                    )
                    RETURNING id
                    """
                )
            )
            driver_result = await conn.execute(
                text(
                    """
                    UPDATE drivers
                    SET moderation_status = 'approved',
                        status = 'available',
                        is_active = TRUE
                    RETURNING id, vehicle_id
                    """
                )
            )
            vehicle_result = await conn.execute(
                text(
                    """
                    UPDATE vehicles
                    SET moderation_status = 'approved',
                        is_active = TRUE
                    WHERE id IN (
                        SELECT vehicle_id
                        FROM drivers
                        WHERE vehicle_id IS NOT NULL
                    )
                    RETURNING id
                    """
                )
            )
            drivers_without_vehicle_result = await conn.execute(
                text(
                    """
                    SELECT id
                    FROM drivers
                    WHERE vehicle_id IS NULL
                    """
                )
            )

            updated_user_ids = user_result.scalars().all()
            updated_driver_rows = driver_result.all()
            updated_vehicle_ids = vehicle_result.scalars().all()
            drivers_without_vehicle_ids = drivers_without_vehicle_result.scalars().all()

        print("Test driver state repair completed.")
        print(f"Activated users: {_count_rows(updated_user_ids)}")
        print(f"Updated drivers to approved/available: {_count_rows(updated_driver_rows)}")
        print(f"Updated vehicles to approved/active: {_count_rows(updated_vehicle_ids)}")
        print(f"Drivers without vehicle link: {_count_rows(drivers_without_vehicle_ids)}")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
