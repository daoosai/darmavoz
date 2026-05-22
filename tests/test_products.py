import pytest

from app.models.models import Product

pytestmark = pytest.mark.asyncio


async def test_products_list_returns_all_products_sorted_by_name(client, session_factory):
    async with session_factory() as session:
        session.add_all(
            [
                Product(
                    name="Щебень",
                    description="Щебень фракции 5-20",
                    price=1800.0,
                    unit_type="тонна",
                    image_url="https://example.com/sheben.jpg",
                ),
                Product(
                    name="Грунт",
                    description="Плодородный грунт",
                    price=1200.0,
                    unit_type="куб",
                    image_url="https://example.com/grunt.jpg",
                ),
                Product(
                    name="Песок",
                    description="Карьерный песок",
                    price=950.0,
                    unit_type="куб",
                    image_url="https://example.com/pesok.jpg",
                ),
            ]
        )
        await session.commit()

    response = await client.get("/api/v1/products/")

    assert response.status_code == 200
    data = response.json()
    assert [item["name"] for item in data] == ["Грунт", "Песок", "Щебень"]
    assert data[0]["unit_type"] == "куб"
    assert data[1]["price"] == 950.0
    assert all(item["id"] for item in data)
