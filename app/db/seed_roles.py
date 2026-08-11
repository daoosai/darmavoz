from sqlalchemy.future import select
from app.models.models import Role
from sqlalchemy.ext.asyncio import AsyncSession

async def seed_roles(session: AsyncSession) -> None:
    roles_data = [
        {"name": "admin", "description": "Administrator with full access"},
        {"name": "logist", "description": "Logistics operator responsible for order dispatching"},
        {"name": "manager", "description": "Managing role with read-only access to operational metrics"},
        {"name": "supplier", "description": "Pickup point owner"},
        {"name": "equipment_owner", "description": "Special equipment owner"},
        {"name": "water_septic_partner", "description": "Water points and septic services partner"},
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
