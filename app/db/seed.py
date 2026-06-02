from sqlalchemy.future import select

from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.db.seed_catalog import seed_catalog
from app.models.models import DeliveryOption, Driver, DriverStatus, Role, User, Vehicle
from app.security.auth import get_password_hash


async def seed_data() -> None:
    async with AsyncSessionLocal() as session:
        roles_data = [
            {"name": "admin", "description": "Administrator with full access"},
            {"name": "logist", "description": "Logistics operator responsible for order dispatching"},
            {"name": "manager", "description": "Managing role with read-only access to operational metrics"},
            {"name": "driver", "description": "Driver who receives and accepts incoming orders"},
        ]

        for role_info in roles_data:
            query = select(Role).where(Role.name == role_info["name"])
            result = await session.execute(query)
            role = result.scalar_one_or_none()

            if role is None:
                session.add(Role(name=role_info["name"], description=role_info["description"]))
            elif role.description != role_info["description"]:
                role.description = role_info["description"]

        await session.commit()

        await ensure_user(session, settings.ADMIN_USERNAME, settings.ADMIN_PASSWORD, "admin")
        await ensure_optional_user(session, settings.LOGIST_USERNAME, settings.LOGIST_PASSWORD, "logist")
        await ensure_optional_user(session, settings.MANAGER_USERNAME, settings.MANAGER_PASSWORD, "manager")
        await seed_catalog(session)
        await ensure_test_dispatch_drivers(session)


async def ensure_optional_user(session, username: str | None, password: str | None, role_name: str) -> None:
    if not username or not password:
        print(f"Optional user for role {role_name} is not configured.")
        return
    await ensure_user(session, username, password, role_name)


async def ensure_user(session, username: str, password: str, role_name: str) -> User:
    query = select(User).where(User.username == username)
    result = await session.execute(query)
    user = result.scalar_one_or_none()

    role_query = select(Role).where(Role.name == role_name)
    role_result = await session.execute(role_query)
    role = role_result.scalar_one()

    if user is None:
        user = User(
            username=username,
            hashed_password=get_password_hash(password),
            role_id=role.id,
            is_active=True,
        )
        session.add(user)
        await session.commit()
        print(f"User {username} with role {role_name} created.")
        return user

    updated = False
    if user.role_id != role.id:
        user.role_id = role.id
        updated = True
    if not user.is_active:
        user.is_active = True
        updated = True

    if updated:
        await session.commit()
        print(f"User {username} with role {role_name} updated.")
    else:
        print(f"User {username} with role {role_name} already exists.")
    return user


async def ensure_test_dispatch_drivers(session) -> None:
    delivery_options = await session.scalars(
        select(DeliveryOption).where(DeliveryOption.capacity_m3.in_([10.0, 20.0]))
    )
    delivery_options_by_capacity = {option.capacity_m3: option for option in delivery_options}
    if 10.0 not in delivery_options_by_capacity or 20.0 not in delivery_options_by_capacity:
        print("Delivery options 10m3/20m3 are missing, skip driver seed.")
        return

    definitions = [
        {
            "username": "driver1",
            "name": "Водитель 1",
            "phone": "+79990000001",
            "vehicle_title": "Камаз 10 м3 #1",
            "capacity_m3": 10.0,
        },
        {
            "username": "driver2",
            "name": "Водитель 2",
            "phone": "+79990000002",
            "vehicle_title": "Камаз 10 м3 #2",
            "capacity_m3": 10.0,
        },
        {
            "username": "driver3",
            "name": "Водитель 3",
            "phone": "+79990000003",
            "vehicle_title": "Камаз 20 м3",
            "capacity_m3": 20.0,
        },
    ]

    for definition in definitions:
        driver_user = await ensure_user(
            session,
            definition["username"],
            settings.DRIVER_TEST_PASSWORD,
            "driver",
        )
        vehicle = await ensure_vehicle(
            session,
            title=definition["vehicle_title"],
            delivery_option_id=delivery_options_by_capacity[definition["capacity_m3"]].id,
        )
        await ensure_driver(
            session,
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            name=definition["name"],
            phone=definition["phone"],
        )

    await session.commit()


async def ensure_vehicle(session, *, title: str, delivery_option_id) -> Vehicle:
    result = await session.execute(select(Vehicle).where(Vehicle.title == title))
    vehicle = result.scalar_one_or_none()
    if vehicle is None:
        vehicle = Vehicle(
            title=title,
            delivery_option_id=delivery_option_id,
            is_active=True,
        )
        session.add(vehicle)
        await session.flush()
        return vehicle

    changed = False
    if vehicle.delivery_option_id != delivery_option_id:
        vehicle.delivery_option_id = delivery_option_id
        changed = True
    if not vehicle.is_active:
        vehicle.is_active = True
        changed = True
    if changed:
        await session.flush()
    return vehicle


async def ensure_driver(session, *, user_id, vehicle_id, name: str, phone: str) -> Driver:
    result = await session.execute(select(Driver).where(Driver.phone == phone))
    driver = result.scalar_one_or_none()
    if driver is None:
        driver = Driver(
            user_id=user_id,
            vehicle_id=vehicle_id,
            name=name,
            phone=phone,
            status=DriverStatus.available.value,
            is_auto_dispatch_enabled=True,
            dispatch_priority=100,
        )
        session.add(driver)
        await session.flush()
        return driver

    driver.user_id = user_id
    driver.vehicle_id = vehicle_id
    driver.name = name
    driver.status = DriverStatus.available.value
    driver.is_auto_dispatch_enabled = True
    if driver.dispatch_priority is None:
        driver.dispatch_priority = 100
    await session.flush()
    return driver
