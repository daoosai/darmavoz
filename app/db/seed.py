import logging

from app.db.database import AsyncSessionLocal
from app.db.seed_catalog import seed_catalog
from app.db.seed_roles import seed_roles
from app.db.seed_users import seed_users

logger = logging.getLogger(__name__)


async def seed_data():
    logger.info("Starting data seeding...")
    async with AsyncSessionLocal() as db:
        await seed_roles(db)
        await seed_users(db)
        await seed_catalog(db)
    logger.info("Data seeding finished.")
