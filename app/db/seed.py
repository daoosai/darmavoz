import asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import Role, User
from app.security.auth import get_password_hash
from app.core.config import settings

async def seed_data(session: AsyncSession):
    # Seed roles
    roles_data = [
        {"name": "admin", "description": "Administrator with full access"},
        {"name": "logist", "description": "Logistics manager"},
        {"name": "manager", "description": "Client manager"},
    ]
    
    for role_info in roles_data:
        query = select(Role).where(Role.name == role_info["name"])
        result = await session.execute(query)
        role = result.scalar_one_or_none()
        
        if not role:
            new_role = Role(name=role_info["name"], description=role_info["description"])
            session.add(new_role)
    
    await session.commit()
    
    # Seed admin user
    query = select(User).where(User.username == settings.ADMIN_USERNAME)
    result = await session.execute(query)
    admin_user = result.scalar_one_or_none()
    
    if not admin_user:
        # Get admin role
        query = select(Role).where(Role.name == "admin")
        result = await session.execute(query)
        admin_role = result.scalar_one()
        
        new_admin = User(
            username=settings.ADMIN_USERNAME,
            hashed_password=get_password_hash(settings.ADMIN_PASSWORD),
            role_id=admin_role.id,
            is_active=True
        )
        session.add(new_admin)
        await session.commit()
        print(f"Admin user '{settings.ADMIN_USERNAME}' created.")
    else:
        print(f"Admin user '{settings.ADMIN_USERNAME}' already exists.")
