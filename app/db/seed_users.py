from sqlalchemy.future import select
from app.core.config import settings
from app.models.models import Role, User
from app.security.auth import get_password_hash
from sqlalchemy.ext.asyncio import AsyncSession

async def seed_users(session: AsyncSession) -> None:
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