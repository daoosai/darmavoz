from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models.models import (
    Category,
    Client,
    DeliveryOption,
    Driver,
    DriverStatus,
    Material,
    Order,
    OrderItem,
    OrderOffer,
    OrderOfferStatus,
    Role,
    User,
    Vehicle,
)
from app.security.auth import get_password_hash
from app.security.jwt import create_access_token


def client_auth_headers(*, email: str, client_id) -> dict[str, str]:
    token = create_access_token(data={"sub": email, "role": "client", "client_id": str(client_id)})
    return {"Authorization": f"Bearer {token}"}


async def ensure_role(session, name: str) -> Role:
    role = await session.scalar(select(Role).where(Role.name == name))
    if role is None:
        role = Role(name=name, description=name)
        session.add(role)
        await session.flush()
    return role


@pytest.mark.asyncio
async def test_client_can_list_own_orders_with_details(client, session_factory):
    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        driver_user = User(
            username="client_orders_driver",
            hashed_password=get_password_hash("secret"),
            role_id=driver_role.id,
            is_active=True,
        )
        category = Category(name="ПГС", slug="client-orders-pgs", sort_order=0, is_active=True)
        material = Material(
            category=category,
            name="ПГС",
            description="",
            price=1800.0,
            unit="m3",
            min_volume=1.0,
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
        vehicle = Vehicle(title="Камаз клиента", delivery_option=delivery_option, is_active=True)
        client_record = Client(name="Orders Client", email="orders-client@example.com", phone="+79990002020")
        other_client = Client(name="Other Client", email="other-client@example.com", phone="+79990003030")
        session.add_all([driver_user, category, material, delivery_option, vehicle, client_record, other_client])
        await session.flush()

        driver = Driver(
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            name="Водитель клиента",
            phone="+79990004040",
            status=DriverStatus.busy.value,
            dispatch_priority=100,
            is_auto_dispatch_enabled=True,
        )
        session.add(driver)
        await session.flush()

        client_order = Order(
            client_id=client_record.id,
            driver_id=driver.id,
            delivery_option_id=delivery_option.id,
            address="Адрес клиента 1",
            total_amount=36000.0,
            status="driver_assigned",
            source="mobile",
            created_by_source="client_app",
            assigned_at=datetime.now(UTC),
        )
        other_order = Order(
            client_id=other_client.id,
            delivery_option_id=delivery_option.id,
            address="Чужой адрес",
            total_amount=18000.0,
            status="created",
            source="mobile",
            created_by_source="client_app",
        )
        session.add_all([client_order, other_order])
        await session.flush()

        session.add_all(
            [
                OrderItem(
                    order_id=client_order.id,
                    material_id=material.id,
                    quantity=2,
                    volume=20.0,
                    price=1800.0,
                    amount=36000.0,
                ),
                OrderItem(
                    order_id=other_order.id,
                    material_id=material.id,
                    quantity=1,
                    volume=10.0,
                    price=1800.0,
                    amount=18000.0,
                ),
            ]
        )
        session.add(
            OrderOffer(
                order_id=client_order.id,
                driver_id=driver.id,
                price=36000.0,
                sequence_no=1,
                status=OrderOfferStatus.accepted.value,
                offered_at=datetime.now(UTC),
                responded_at=datetime.now(UTC),
                expires_at=datetime.now(UTC) + timedelta(minutes=2),
            )
        )
        await session.commit()
        await session.refresh(client_record)

    response = await client.get(
        "/api/v1/clients/me/orders",
        headers=client_auth_headers(email="orders-client@example.com", client_id=client_record.id),
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["client_id"] == str(client_record.id)
    assert payload[0]["status"] == "driver_assigned"
    assert payload[0]["total_amount"] == 36000.0
    assert payload[0]["quantity"] == 2
    assert payload[0]["items"][0]["material"]["name"] == "ПГС"
    assert payload[0]["items"][0]["volume"] == 20.0
    assert payload[0]["driver"]["name"] == "Водитель клиента"
