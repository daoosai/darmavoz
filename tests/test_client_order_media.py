"""Client order API must include uploaded catalog media, not only legacy URLs."""

from uuid import uuid4

import pytest

from app.models.models import (
    Category,
    Client,
    DeliveryOption,
    Material,
    MediaFile,
    Order,
    OrderItem,
)
from app.security.jwt import create_access_token


@pytest.mark.asyncio
async def test_client_orders_include_primary_material_and_delivery_media(
    client, session_factory
):
    async with session_factory() as db:
        buyer = Client(name="Order media QA", email=f"{uuid4().hex}@example.com")
        db.add(buyer)
        await db.flush()
        category = Category(name="Order media QA", slug=f"order-media-{uuid4().hex}")
        db.add(category)
        await db.flush()
        material = Material(
            name="Order media QA",
            category_id=category.id,
            price=100,
            unit="m3",
            is_active=True,
        )
        truck = DeliveryOption(
            title="Order media QA",
            capacity_m3=10,
            delivery_rate_per_km=100,
            min_price_quarry=500,
            min_price_warehouse=500,
            is_active=True,
        )
        db.add_all([material, truck])
        await db.flush()
        order = Order(
            client_id=buyer.id,
            delivery_option_id=truck.id,
            status="created",
            address="Тюмень, тестовый адрес, 1",
            total_amount=100,
        )
        db.add(order)
        await db.flush()
        db.add(
            OrderItem(
                order_id=order.id,
                material_id=material.id,
                quantity=1,
                volume=3,
                price=100,
                amount=100,
            )
        )
        media = []
        for kind, entity in [("material", material), ("delivery_option", truck)]:
            for primary in [False, True]:
                key = f"qa/{uuid4().hex}.png"
                media.append(
                    MediaFile(
                        entity_type=kind,
                        entity_id=entity.id,
                        bucket="qa",
                        object_key=key,
                        public_url=f"https://test.darmavoz.ru/s3/qa/{key}",
                        content_type="image/png",
                        file_name="qa.png",
                        file_size=10,
                        is_primary=primary,
                    )
                )
        db.add_all(media)
        await db.commit()
        token = create_access_token(
            {"sub": buyer.email, "role": "client", "client_id": str(buyer.id)}
        )
        order_id = str(order.id)
        expected = {row.entity_type: row.public_url for row in media if row.is_primary}
    response = await client.get(
        "/api/v1/clients/me/orders", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200, response.text
    assert [row["id"] for row in response.json()] == [order_id]
    row = response.json()[0]
    for kind, entity in [
        ("material", row["items"][0]["material"]),
        ("delivery_option", row["delivery_option"]),
    ]:
        assert entity["primary_image_url"] == expected[kind]
        assert entity["media_files"][0]["public_url"] == expected[kind]
