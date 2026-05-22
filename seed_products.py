import asyncio
import json
import os
import sys
from pathlib import Path

from sqlalchemy import select

sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from app.db.database import AsyncSessionLocal
from app.models.models import Product

DEFAULT_PRODUCTS_PATH = Path(__file__).resolve().parent / "data" / "mock_products.json"


async def seed_products(json_path: Path = DEFAULT_PRODUCTS_PATH) -> None:
    products_payload = json.loads(json_path.read_text(encoding="utf-8"))

    async with AsyncSessionLocal() as session:
        for item in products_payload:
            result = await session.execute(
                select(Product).where(Product.name == item["name"])
            )
            product = result.scalar_one_or_none()

            if product is None:
                session.add(Product(**item))
                continue

            product.description = item["description"]
            product.price = item["price"]
            product.unit_type = item["unit_type"]
            product.image_url = item["image_url"]

        await session.commit()


def main() -> None:
    seed_path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_PRODUCTS_PATH
    asyncio.run(seed_products(seed_path))
    print(f"Products loaded from {seed_path}")


if __name__ == "__main__":
    main()
