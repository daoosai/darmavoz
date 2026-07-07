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
            "delivery_lat": 55.751,
            "delivery_lon": 37.618,
            "quantity": 3,
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["quantity"] == 3
    assert payload["total_amount"] == 75000.0
    assert payload["delivery_address"] == "Тестовый адрес"
    assert payload["delivery_lat"] == 55.751
    assert payload["delivery_lon"] == 37.618
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
    assert order.delivery_address == "Тестовый адрес"
    assert order.delivery_lat == 55.751
    assert order.delivery_lon == 37.618
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


@pytest.mark.asyncio
async def test_checkout_supports_address_id_and_delivery_address_alias(client, session_factory):
    from app.models.models import Client, ClientAddress

    category = Category(name="Грунт", slug="soil-checkout-address", sort_order=0, is_active=True)
    material = Material(
        category=category,
        name="Плодородный грунт",
        description="",
        price=1500.0,
        unit="m3",
        min_volume=5.0,
        is_active=True,
        sort_order=0,
    )
    delivery_option = DeliveryOption(
        capacity_m3=5.0,
        title="5 м3",
        description="",
        base_price=0.0,
        is_active=True,
        sort_order=0,
    )

    async with session_factory() as session:
        client_record = Client(name="Addressed Client", email="address-checkout@example.com", phone="+79990003030")
        session.add_all([category, material, delivery_option, client_record])
        await session.flush()
        address = ClientAddress(
            client_id=client_record.id,
            full_address="Москва, Ленинградский 12",
            comment="Около шлагбаума",
            lat=55.82,
            lon=37.49,
            is_default=True,
        )
        session.add(address)
        await session.commit()
        await session.refresh(material)
        await session.refresh(delivery_option)
        await session.refresh(client_record)
        await session.refresh(address)

    headers = client_auth_headers(email="address-checkout@example.com", client_id=client_record.id)

    by_address_id = await client.post(
        "/api/v1/orders/checkout",
        json={
            "material_id": str(material.id),
            "delivery_option_id": str(delivery_option.id),
            "address_id": str(address.id),
            "quantity": 1,
        },
        headers=headers,
    )
    assert by_address_id.status_code == 201
    first_payload = by_address_id.json()
    assert first_payload["address"] == "Москва, Ленинградский 12"
    assert first_payload["delivery_address"] == "Москва, Ленинградский 12"
    assert first_payload["delivery_lat"] == 55.82
    assert first_payload["delivery_lon"] == 37.49

    by_delivery_alias = await client.post(
        "/api/v1/orders/checkout",
        json={
            "material_id": str(material.id),
            "delivery_option_id": str(delivery_option.id),
            "delivery_address": "Москва, Новый Арбат 5",
            "delivery_lat": 55.7515,
            "delivery_lon": 37.58,
            "quantity": 1,
        },
        headers=headers,
    )
    assert by_delivery_alias.status_code == 201
    second_payload = by_delivery_alias.json()
    assert second_payload["address"] == "Москва, Новый Арбат 5"
    assert second_payload["delivery_address"] == "Москва, Новый Арбат 5"
    assert second_payload["delivery_lat"] == 55.7515
    assert second_payload["delivery_lon"] == 37.58
