import pytest
from sqlalchemy import select

from app.models.models import Category, DeliveryOption, Order, OrderItem, OrderStatus, Material


@pytest.mark.asyncio
async def test_checkout_persists_and_returns_quantity(client, session_factory):
    category = Category(name="Песок", slug="sand", sort_order=0, is_active=True)
    material = Material(
        category=category,
        name="Карьерный песок",
        description="",
        price=2500.0,
        unit="m3",
        min_volume=5.0,
        is_active=True,
        sort_order=0,
    )
    delivery_option = DeliveryOption(
        capacity_m3=10.0,
        title="10 м3",
        description="",
        base_price=0.0,
        is_active=True,
        sort_order=0,
    )

    async with session_factory() as session:
        session.add_all([category, material, delivery_option])
        await session.commit()
        await session.refresh(material)
        await session.refresh(delivery_option)

    response = await client.post(
        "/api/v1/orders/checkout",
        json={
            "material_id": str(material.id),
            "delivery_option_id": str(delivery_option.id),
            "address": "Тестовый адрес",
            "quantity": 3,
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["quantity"] == 3
    assert payload["total_amount"] == 75000.0
    assert len(payload["items"]) == 1
    assert payload["items"][0]["quantity"] == 3
    assert payload["items"][0]["volume"] == 30.0
    assert payload["items"][0]["amount"] == 75000.0
    assert payload["status"] == OrderStatus.searching_driver.value

    async with session_factory() as session:
        order = await session.scalar(select(Order).where(Order.id == payload["id"]))
        order_item = await session.scalar(select(OrderItem).where(OrderItem.order_id == payload["id"]))

    assert order is not None
    assert order.total_amount == 75000.0
    assert order_item is not None
    assert order_item.quantity == 3
    assert order_item.volume == 30.0
    assert order_item.amount == 75000.0
