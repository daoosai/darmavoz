from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.models.models import Category, Client, DeliveryOption, Driver, Material, Order, OrderItem, Role, User, Vehicle
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
async def test_admin_orders_supports_driver_and_date_filters(client, session_factory):
    target_date = datetime(2026, 6, 30, 10, 30, tzinfo=UTC)
    target_date_late = datetime(2026, 6, 30, 23, 59, 59, tzinfo=UTC)
    other_date = datetime(2026, 7, 1, 0, 0, 1, tzinfo=UTC)

    async with session_factory() as session:
        logist_role = await ensure_role(session, "logist")
        driver_role = await ensure_role(session, "driver")
        logist_user = await create_user(session, username="orders_logist", role=logist_role)
        driver_user_1 = await create_user(session, username="orders_driver_1", role=driver_role)
        driver_user_2 = await create_user(session, username="orders_driver_2", role=driver_role)

        category = Category(name="Песок", slug="orders-filter", sort_order=0, is_active=True)
        material = Material(
            category=category,
            name="Песок",
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
        client_record = Client(name="Клиент", phone="+79990033000")
        session.add_all([category, material, delivery_option, client_record])
        await session.flush()

        vehicle_1 = Vehicle(title="Truck #1", delivery_option_id=delivery_option.id, is_active=True, moderation_status="approved")
        vehicle_2 = Vehicle(title="Truck #2", delivery_option_id=delivery_option.id, is_active=True, moderation_status="approved")
        session.add_all([vehicle_1, vehicle_2])
        await session.flush()

        driver_1 = Driver(
            name="Водитель 1",
            phone="+79990033001",
            user_id=driver_user_1.id,
            vehicle_id=vehicle_1.id,
            status="available",
            is_active=True,
            moderation_status="approved",
        )
        driver_2 = Driver(
            name="Водитель 2",
            phone="+79990033002",
            user_id=driver_user_2.id,
            vehicle_id=vehicle_2.id,
            status="busy",
            is_active=True,
            moderation_status="approved",
        )
        session.add_all([driver_1, driver_2])
        await session.flush()

        matching_order = Order(
            client_id=client_record.id,
            driver_id=driver_1.id,
            delivery_option_id=delivery_option.id,
            delivery_address="Тюмень, Лесная 1",
            address="Тюмень, Лесная 1",
            total_amount=15000.0,
            status="driver_assigned",
            source="dispatcher",
            created_at=target_date,
        )
        same_day_other_driver = Order(
            client_id=client_record.id,
            driver_id=driver_2.id,
            delivery_option_id=delivery_option.id,
            delivery_address="Тюмень, Полевая 2",
            address="Тюмень, Полевая 2",
            total_amount=18000.0,
            status="driver_assigned",
            source="dispatcher",
            created_at=target_date_late,
        )
        next_day_same_driver = Order(
            client_id=client_record.id,
            driver_id=driver_1.id,
            delivery_option_id=delivery_option.id,
            delivery_address="Тюмень, Центральная 3",
            address="Тюмень, Центральная 3",
            total_amount=19000.0,
            status="driver_assigned",
            source="dispatcher",
            created_at=other_date,
        )
        session.add_all([matching_order, same_day_other_driver, next_day_same_driver])
        await session.flush()

        session.add_all(
            [
                OrderItem(
                    order_id=matching_order.id,
                    material_id=material.id,
                    quantity=1,
                    volume=20.0,
                    price=3000.0,
                    amount=15000.0,
                ),
                OrderItem(
                    order_id=same_day_other_driver.id,
                    material_id=material.id,
                    quantity=1,
                    volume=20.0,
                    price=3000.0,
                    amount=18000.0,
                ),
                OrderItem(
                    order_id=next_day_same_driver.id,
                    material_id=material.id,
                    quantity=1,
                    volume=20.0,
                    price=3000.0,
                    amount=19000.0,
                ),
            ]
        )
        await session.commit()

    by_date = await client.get(
        "/api/v1/admin/orders",
        params={"date": "2026-06-30"},
        headers=auth_headers(logist_user.username),
    )
    assert by_date.status_code == 200
    by_date_payload = by_date.json()
    assert [item["delivery_address"] for item in by_date_payload] == [
        "Тюмень, Полевая 2",
        "Тюмень, Лесная 1",
    ]

    legacy_by_date = await client.get(
        "/api/v1/orders/admin",
        params={"date": "2026-06-30"},
        headers=auth_headers(logist_user.username),
    )
    assert legacy_by_date.status_code == 200
    assert legacy_by_date.json() == by_date_payload

    by_driver_and_date = await client.get(
        "/api/v1/admin/orders",
        params={"driver_id": str(driver_1.id), "date": "2026-06-30"},
        headers=auth_headers(logist_user.username),
    )
    assert by_driver_and_date.status_code == 200
    by_driver_and_date_payload = by_driver_and_date.json()
    assert len(by_driver_and_date_payload) == 1
    assert by_driver_and_date_payload[0]["driver_id"] == str(driver_1.id)
    assert by_driver_and_date_payload[0]["delivery_address"] == "Тюмень, Лесная 1"
