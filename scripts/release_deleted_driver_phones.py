import asyncio
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.database import AsyncSessionLocal
from app.models.models import Driver, User


MARKER = "_del_"


def build_deleted_unique_value(value: str | None, *, max_length: int) -> str:
    suffix = f"{MARKER}{uuid4().hex[:6]}"
    base = (value or "deleted").strip() or "deleted"
    if len(base) + len(suffix) > max_length:
        base = base[: max_length - len(suffix)]
    return f"{base}{suffix}"


async def main() -> None:
    updated_drivers = 0
    updated_linked_users = 0
    updated_orphan_users = 0
    linked_user_ids: set = set()

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Driver)
            .options(selectinload(Driver.user))
            .where(Driver.is_active.is_(False))
        )
        for driver in result.scalars().all():
            if MARKER not in (driver.phone or ""):
                driver.phone = build_deleted_unique_value(driver.phone, max_length=20)
                updated_drivers += 1

            if driver.user is not None:
                linked_user_ids.add(driver.user.id)
                if MARKER not in (driver.user.username or ""):
                    driver.user.username = build_deleted_unique_value(driver.user.username, max_length=50)
                    updated_linked_users += 1

        result = await db.execute(
            select(User)
            .options(selectinload(User.role), selectinload(User.driver_profile))
            .where(User.is_active.is_(False))
        )
        for user in result.scalars().all():
            if user.id in linked_user_ids:
                continue
            if user.role is None or user.role.name != "driver":
                continue
            if user.driver_profile is not None:
                continue
            if MARKER in (user.username or ""):
                continue
            user.username = build_deleted_unique_value(user.username, max_length=50)
            updated_orphan_users += 1

        await db.commit()

    print(
        {
            "updated_drivers": updated_drivers,
            "updated_linked_users": updated_linked_users,
            "updated_orphan_users": updated_orphan_users,
        }
    )


if __name__ == "__main__":
    asyncio.run(main())
