from sqlalchemy.future import select

from app.core.config import settings
from app.db.database import AsyncSessionLocal
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

        query = select(User).where(User.username == settings.ADMIN_USERNAME)
        result = await session.execute(query)
        admin_user = result.scalar_one_or_none()

        if admin_user is None:
            query = select(Role).where(Role.name == "admin")
            result = await session.execute(query)
            admin_role = result.scalar_one()

            session.add(
                User(
                    username=settings.ADMIN_USERNAME,
                    hashed_password=get_password_hash(settings.ADMIN_PASSWORD),
                    role_id=admin_role.id,
                    is_active=True,
                )
            )
            await session.commit()
            print(f"Admin user '{settings.ADMIN_USERNAME}' created.")
        else:
            print(f"Admin user '{settings.ADMIN_USERNAME}' already exists.")
