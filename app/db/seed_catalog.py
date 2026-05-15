import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import Category, Material

logger = logging.getLogger(__name__)

CATEGORIES = [
    {"name": "Песок", "slug": "sand"},
    {"name": "Щебень", "slug": "crushed_stone"},
    {"name": "Грунт", "slug": "soil"},
]

MATERIALS = {
    "sand": [
        {
            "name": "Песок строительный",
            "description": "Мелкозернистый, подходит для кладочных и штукатурных работ.",
            "price": 800.0,
            "unit": "м³",
            "min_volume": 5.0,
            "image_url": "https://images.unsplash.com/photo-1559333219-b45e66b3e88a?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1470&q=80",
        },
        {
            "name": "Песок речной",
            "description": "Крупнозернистый, используется для дренажа и бетонных смесей.",
            "price": 950.0,
            "unit": "м³",
            "min_volume": 10.0,
            "image_url": "https://images.unsplash.com/photo-1618524579245-938d853b178d?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1470&q=80",
        },
    ],
    "crushed_stone": [
        {
            "name": "Щебень гранитный 5-20 мм",
            "description": "Используется в производстве бетона, асфальта и для дорожных работ.",
            "price": 2500.0,
            "unit": "т",
            "min_volume": 3.0,
            "image_url": "https://images.unsplash.com/photo-1529232577773-8b35f1543777?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1470&q=80",
        }
    ],
    "soil": [
        {
            "name": "Плодородный грунт",
            "description": "Чернозем, обогащенный органическими веществами для садоводства.",
            "price": 1200.0,
            "unit": "м³",
            "min_volume": 2.0,
            "image_url": "https://images.unsplash.com/photo-1599409333945-963a34a85b47?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1470&q=80",
        }
    ],
}


async def seed_catalog(db: AsyncSession):
    logger.info("Seeding catalog data...")

    for cat_data in CATEGORIES:
        result = await db.execute(select(Category).filter_by(slug=cat_data["slug"]))
        category = result.scalars().first()
        if not category:
            category = Category(**cat_data)
            db.add(category)
            await db.flush()
            logger.info(f"Created category: {category.name}")

            for mat_data in MATERIALS.get(category.slug, []):
                material = Material(category_id=category.id, **mat_data)
                db.add(material)
                logger.info(f"  - Created material: {material.name}")

    await db.commit()
    logger.info("Catalog seeding finished.")
