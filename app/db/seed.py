from sqlalchemy.future import select

from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.db.seed_catalog import seed_catalog
from app.models.models import Role, User
from app.security.auth import get_password_hash


async def seed_data() -> None:
    async with AsyncSessionLocal() as session:
        roles_data = [
            {"name": "admin", "description": "Administrator with full access"},
            {"name": "logist", "description": "Logistics operator responsible for order dispatching"},
            {"name": "manager", "description": "Managing role with read-only access to operational metrics"},
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


async def ensure_optional_user(session, username: str | None, password: str | None, role_name: str) -> None:
    if not username or not password:
        print(f"Optional user for role {role_name} is not configured.")
        return
    await ensure_user(session, username, password, role_name)


async def ensure_user(session, username: str, password: str, role_name: str) -> None:
    query = select(User).where(User.username == username)
    result = await session.execute(query)
    user = result.scalar_one_or_none()

    role_query = select(Role).where(Role.name == role_name)
    role_result = await session.execute(role_query)
    role = role_result.scalar_one()

    if user is None:
        session.add(
            User(
                username=username,
                hashed_password=get_password_hash(password),
                role_id=role.id,
                is_active=True,
            )
        )
        await session.commit()
        print(f"User {username} with role {role_name} created.")
        return

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
