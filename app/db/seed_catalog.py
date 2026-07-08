import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import AsyncSessionLocal
from app.models.models import Category, DeliveryOption, Material

logger = logging.getLogger(__name__)

CATEGORIES = [
    {"name": "Песок", "slug": "sand", "sort_order": 10},
    {"name": "Щебень", "slug": "crushed_stone", "sort_order": 20},
    {"name": "Грунт", "slug": "soil", "sort_order": 30},
    {"name": "Прочее", "slug": "other", "sort_order": 40},
]

MATERIALS = {
    "sand": [
        {
            "name": "Песок строительный",
            "description": "Мелкозернистый, подходит для кладочных и штукатурных работ.",
            "price": 800.0,
            "unit": "м3",
            "min_volume": 5.0,
            "image_url": "https://images.unsplash.com/photo-1559333219-b45e66b3e88a?auto=format&fit=crop&w=1470&q=80",
            "sort_order": 10,
        },
        {
            "name": "Песок речной",
            "description": "Крупнозернистый, используется для дренажа и бетонных смесей.",
            "price": 950.0,
            "unit": "м3",
            "min_volume": 10.0,
            "image_url": "https://images.unsplash.com/photo-1618524579245-938d853b178d?auto=format&fit=crop&w=1470&q=80",
            "sort_order": 20,
        },
    ],
    "crushed_stone": [
        {
            "name": "Щебень гранитный 5-20 мм",
            "description": "Используется в производстве бетона, асфальта и для дорожных работ.",
            "price": 2500.0,
            "unit": "т",
            "min_volume": 3.0,
            "image_url": "https://images.unsplash.com/photo-1529232577773-8b35f1543777?auto=format&fit=crop&w=1470&q=80",
            "sort_order": 10,
        }
    ],
    "soil": [
        {
            "name": "Плодородный грунт",
            "description": "Чернозем, обогащенный органическими веществами для садоводства.",
            "price": 1200.0,
            "unit": "м3",
            "min_volume": 2.0,
            "image_url": "https://images.unsplash.com/photo-1599409333945-963a34a85b47?auto=format&fit=crop&w=1470&q=80",
            "sort_order": 10,
        }
    ],
    "other": [],
}

DEFAULT_DELIVERY_OPTIONS = [
    {
        "capacity_m3": 5.0,
        "min_delivery_price": 3500.0,
        "title": "Зил 5 м3",
        "description": "Компактная машина для небольших доставок.",
        "sort_order": 10,
    },
    {
        "capacity_m3": 10.0,
        "min_delivery_price": 4000.0,
        "title": "КамАЗ 10 м3",
        "description": "Базовый вариант для стандартного заказа.",
        "sort_order": 20,
    },
    {
        "capacity_m3": 17.0,
        "min_delivery_price": 5000.0,
        "title": "КамАЗ 17 м3",
        "description": "Усиленный вариант для среднего объема.",
        "sort_order": 30,
    },
    {
        "capacity_m3": 20.0,
        "min_delivery_price": 5000.0,
        "title": "Самосвал 20 м3",
        "description": "Подходит для крупных доставок сыпучих материалов.",
        "sort_order": 40,
    },
    {
        "capacity_m3": 25.0,
        "min_delivery_price": 5000.0,
        "title": "Самосвал 25 м3",
        "description": "Вместительный вариант для стройплощадок.",
        "sort_order": 50,
    },
    {
        "capacity_m3": 30.0,
        "min_delivery_price": 5000.0,
        "title": "Самосвал 30 м3",
        "description": "Максимальная стартовая кубатура для крупных заявок.",
        "sort_order": 60,
    },
]


async def seed_catalog(session: AsyncSession | None = None) -> None:
    owns_session = session is None
    if owns_session:
        async with AsyncSessionLocal() as new_session:
            await _seed_catalog(new_session)
    else:
        await _seed_catalog(session)


async def seed_delivery_options(session: AsyncSession | None = None) -> None:
    await seed_catalog(session)


async def _seed_catalog(session: AsyncSession) -> None:
    logger.info("Seeding catalog and delivery options...")

    for category_data in CATEGORIES:
        result = await session.execute(select(Category).where(Category.slug == category_data["slug"]))
        category = result.scalar_one_or_none()

        if category is None:
            category = Category(
                name=category_data["name"],
                slug=category_data["slug"],
                sort_order=category_data["sort_order"],
                is_active=True,
            )
            session.add(category)
            await session.flush()
        else:
            category.name = category_data["name"]
            category.sort_order = category_data["sort_order"]
            category.is_active = True

        for material_data in MATERIALS.get(category.slug, []):
            result = await session.execute(
                select(Material)
                .where(
                    Material.category_id == category.id,
                    Material.name == material_data["name"],
                )
                .order_by(Material.is_active.desc(), Material.id.asc())
            )
            # Test syncs may leave inactive duplicates; keep startup idempotent by reusing the first row.
            material = result.scalars().first()
            if material is None:
                session.add(Material(category_id=category.id, is_active=True, **material_data))
                continue

            for field, value in material_data.items():
                setattr(material, field, value)
            material.is_active = True

    for option_data in DEFAULT_DELIVERY_OPTIONS:
        result = await session.execute(
            select(DeliveryOption)
            .where(DeliveryOption.capacity_m3 == option_data["capacity_m3"])
            .order_by(DeliveryOption.id.asc())
        )
        # Test data may create duplicate capacity rows; keep startup idempotent by reusing the first one.
        delivery_option = result.scalars().first()
        if delivery_option is None:
            session.add(DeliveryOption(**option_data, is_active=True, base_price=None))
            continue

        # Preserve admin-managed titles; only keep seed metadata in sync.
        for field in ("description", "sort_order", "min_delivery_price"):
            setattr(delivery_option, field, option_data[field])
        if not delivery_option.title:
            delivery_option.title = option_data["title"]
        delivery_option.is_active = True

    await session.commit()
    logger.info("Catalog and delivery options seeding finished.")


if __name__ == "__main__":
    asyncio.run(seed_catalog())
