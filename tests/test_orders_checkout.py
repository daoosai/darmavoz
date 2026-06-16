import pytest
from sqlalchemy import select

from app.models.models import Category, DeliveryOption, Order, OrderItem, OrderStatus, Material
from app.security.jwt import create_access_token


def client_auth_headers(*, email: str, client_id) -> dict[str, str]:
    token = create_access_token(data={"sub": email, "role": "client", "client_id": str(client_id)})
    return {"Authorization": f"Bearer {token}"}


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


@pytest.mark.asyncio
async def test_checkout_uses_client_from_jwt_when_present(client, session_factory):
    from app.models.models import Client

    category = Category(name="Щебень", slug="stone-checkout-client", sort_order=0, is_active=True)
    material = Material(
        category=category,
        name="Щебень фракция 20-40",
        description="",
        price=3000.0,
        unit="m3",
        min_volume=5.0,
        is_active=True,
        sort_order=0,
    )
    delivery_option = DeliveryOption(
        capacity_m3=20.0,
        title="20 м3",
        description="",
        base_price=0.0,
        is_active=True,
        sort_order=0,
    )

    async with session_factory() as session:
        client_record = Client(name="JWT Client", email="jwt-client@example.com", phone="+79990001010")
        session.add_all([category, material, delivery_option, client_record])
        await session.commit()
        await session.refresh(material)
        await session.refresh(delivery_option)
        await session.refresh(client_record)

    response = await client.post(
        "/api/v1/orders/checkout",
        json={
            "client_id": None,
            "material_id": str(material.id),
            "delivery_option_id": str(delivery_option.id),
            "address": "Адрес клиента",
            "quantity": 2,
        },
        headers=client_auth_headers(email="jwt-client@example.com", client_id=client_record.id),
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["client_id"] == str(client_record.id)

    async with session_factory() as session:
        order = await session.scalar(select(Order).where(Order.id == payload["id"]))

    assert order is not None
    assert order.client_id == client_record.id
