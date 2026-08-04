from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models.models import (
    Category,
    Client,
    DeliveryOption,
    Driver,
    Material,
    ModerationStatus,
    Order,
    OrderItem,
    OrderOffer,
    Role,
    User,
    Vehicle,
    Quarry,
)
from app.security.auth import get_password_hash
from app.security.jwt import create_access_token


def auth_headers(username: str) -> dict[str, str]:
    token = create_access_token(data={"sub": username})
    return {"Authorization": f"Bearer {token}"}


async def ensure_role(session, name: str) -> Role:
    role = await session.scalar(select(Role).where(Role.name == name))
    if role is None:
        role = Role(name=name, description=name)
        session.add(role)
        await session.flush()
    return role


async def create_user(session, *, username: str, role: Role) -> User:
    user = User(
        username=username,
        hashed_password=get_password_hash("secret123"),
        role_id=role.id,
        is_active=True,
    )
    session.add(user)
    await session.flush()
    return user


@pytest.mark.asyncio
async def test_driver_current_order_endpoints_include_route_fields(client, session_factory):
    now = datetime.now(UTC)

    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        driver_user = await create_user(session, username="route_driver", role=driver_role)

        category = Category(name="Материалы", slug="route-fields", sort_order=0, is_active=True)
        material = Material(
            category=category,
            name="Песок",
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
        quarry = Quarry(
            name="Карьер Северный",
            address="Тюмень, Карьерная 1",
            lat=57.012969,
            lon=65.963904,
            is_active=True,
        )
        client_record = Client(name="Клиент", phone="+79990044000")
        session.add_all([category, material, delivery_option, quarry, client_record])
        await session.flush()

        vehicle = Vehicle(
            title="КамАЗ",
            delivery_option_id=delivery_option.id,
            is_active=True,
            moderation_status=ModerationStatus.approved.value,
        )
        session.add(vehicle)
        await session.flush()

        driver = Driver(
            name="Водитель Маршрута",
            phone="+79990044001",
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            status="busy",
            is_active=True,
            moderation_status=ModerationStatus.approved.value,
        )
        session.add(driver)
        await session.flush()

        assigned_order = Order(
            client_id=client_record.id,
            driver_id=driver.id,
            delivery_option_id=delivery_option.id,
            quarry_id=quarry.id,
            address="Тюмень, Лесная 10",
            delivery_address=None,
            delivery_lat=57.152223,
            delivery_lon=65.527202,
            pickup_address=None,
            pickup_lat=None,
            pickup_lon=None,
            total_amount=25000.0,
            status="driver_assigned",
            assigned_at=now,
        )
        incoming_order = Order(
            client_id=client_record.id,
            driver_id=None,
            delivery_option_id=delivery_option.id,
            quarry_id=quarry.id,
            address="Тюмень, Полевая 20",
            delivery_address=None,
            delivery_lat=57.140000,
            delivery_lon=65.600000,
            pickup_address=None,
            pickup_lat=None,
            pickup_lon=None,
            total_amount=27000.0,
            status="offered_to_driver",
            created_at=now,
        )
        session.add_all([assigned_order, incoming_order])
        await session.flush()

        session.add_all(
            [
                OrderItem(
                    order_id=assigned_order.id,
                    material_id=material.id,
                    quantity=1,
                    volume=10.0,
                    price=2500.0,
                    amount=25000.0,
                ),
                OrderItem(
                    order_id=incoming_order.id,
                    material_id=material.id,
                    quantity=1,
                    volume=10.0,
                    price=2500.0,
                    amount=27000.0,
                ),
            ]
        )
        await session.flush()

        offer = OrderOffer(
            order_id=incoming_order.id,
            driver_id=driver.id,
            price=27000.0,
            sequence_no=1,
            status="pending",
            offered_at=now,
            expires_at=now + timedelta(minutes=5),
        )
        session.add(offer)
        await session.commit()

    incoming_response = await client.get(
        "/api/v1/driver/orders/incoming/current",
        headers=auth_headers("route_driver"),
    )
    assert incoming_response.status_code == 200
    incoming_payload = incoming_response.json()
    assert incoming_payload["order"]["pickup_address"] == "Тюмень, Карьерная 1"
    assert incoming_payload["order"]["pickup_lat"] == 57.012969
    assert incoming_payload["order"]["pickup_lon"] == 65.963904
    assert incoming_payload["order"]["delivery_address"] == "Тюмень, Полевая 20"
    assert incoming_payload["order"]["delivery_lat"] == 57.14
    assert incoming_payload["order"]["delivery_lon"] == 65.6

    assigned_response = await client.get(
        "/api/v1/driver/orders/assigned/current",
        headers=auth_headers("route_driver"),
    )
    assert assigned_response.status_code == 200
    assigned_payload = assigned_response.json()
    assert assigned_payload["order"]["pickup_address"] == "Тюмень, Карьерная 1"
    assert assigned_payload["order"]["pickup_lat"] == 57.012969
    assert assigned_payload["order"]["pickup_lon"] == 65.963904
    assert assigned_payload["order"]["delivery_address"] == "Тюмень, Лесная 10"
    assert assigned_payload["order"]["delivery_lat"] == 57.152223
    assert assigned_payload["order"]["delivery_lon"] == 65.527202
