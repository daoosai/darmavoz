import asyncio

from sqlalchemy import select

from app.db.database import AsyncSessionLocal
from app.models.models import Driver, ModerationStatus, Role, User, Vehicle
from app.security.auth import get_password_hash

PLACEHOLDER_PASSWORD = "TempPass123!"


def _fallback_phone(seed: str) -> str:
    digits = "".join(ch for ch in seed if ch.isdigit())
    digits = (digits + "0000000000")[:10]
    return f"+7{digits}"


def _fallback_vehicle_title(vehicle: Vehicle) -> str:
    parts = [part.strip() for part in (vehicle.brand or "", vehicle.plate_number or "") if part and part.strip()]
    if parts:
        return " / ".join(parts)
    return f"Машина {str(vehicle.id)[:8]}"


async def _get_or_create_role(session, role_name: str, description: str) -> Role:
    role = await session.scalar(select(Role).where(Role.name == role_name))
    if role is None:
        role = Role(name=role_name, description=description)
        session.add(role)
        await session.flush()
    return role


async def main() -> None:
    async with AsyncSessionLocal() as session:
        drivers = list((await session.scalars(select(Driver).order_by(Driver.id))).all())
        users = list((await session.scalars(select(User).order_by(User.id))).all())
        vehicles = list((await session.scalars(select(Vehicle).order_by(Vehicle.id))).all())

        driver_role = await _get_or_create_role(session, "driver", "Driver application user")
        manager_role = await _get_or_create_role(session, "manager", "Default manager role for legacy users")

        updated_users = 0
        updated_drivers = 0
        updated_vehicles = 0

        drivers_by_user_id = {driver.user_id: driver for driver in drivers if driver.user_id is not None}

        for user in users:
            changed = False
            linked_driver = drivers_by_user_id.get(user.id)

            if not user.username:
                user.username = linked_driver.phone if linked_driver and linked_driver.phone else f"user-{str(user.id)[:8]}"
                changed = True
            if not user.hashed_password:
                user.hashed_password = get_password_hash(PLACEHOLDER_PASSWORD)
                changed = True
            if user.is_active is None:
                user.is_active = True
                changed = True
            if user.role_id is None:
                user.role_id = driver_role.id if linked_driver is not None else manager_role.id
                changed = True

            if changed:
                updated_users += 1

        for driver in drivers:
            changed = False

            if not driver.phone:
                seed_value = str(driver.user_id or driver.id).replace("-", "")
                driver.phone = _fallback_phone(seed_value)
                changed = True
            if not driver.name:
                suffix = "".join(ch for ch in driver.phone if ch.isdigit())[-4:] or str(driver.id)[:4]
                driver.name = f"Водитель {suffix}"
                changed = True
            if not driver.status:
                driver.status = "offline"
                changed = True
            if not driver.moderation_status:
                driver.moderation_status = ModerationStatus.incomplete.value
                changed = True
            if driver.is_active is None:
                driver.is_active = True
                changed = True
            if driver.is_auto_dispatch_enabled is None:
                driver.is_auto_dispatch_enabled = False
                changed = True
            if driver.dispatch_priority is None:
                driver.dispatch_priority = 100
                changed = True

            if changed:
                updated_drivers += 1

        for vehicle in vehicles:
            changed = False

            if not vehicle.title:
                vehicle.title = _fallback_vehicle_title(vehicle)
                changed = True
            if vehicle.is_active is None:
                vehicle.is_active = True
                changed = True
            if not vehicle.moderation_status:
                vehicle.moderation_status = ModerationStatus.incomplete.value
                changed = True

            if changed:
                updated_vehicles += 1

        await session.commit()
        print(
            f"legacy_fix_completed users={updated_users} drivers={updated_drivers} vehicles={updated_vehicles}"
        )


if __name__ == "__main__":
    asyncio.run(main())
