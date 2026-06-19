from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models.models import (
    Category,
    Client,
    DeliveryOption,
    Driver,
    DriverStatus,
    EventLog,
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
        hashed_password=get_password_hash("secret"),
        role_id=role.id,
        is_active=True,
    )
    session.add(user)
    await session.flush()
    return user


@pytest.mark.asyncio
async def test_system_version_endpoint_returns_public_apk_info(client):
    response = await client.get("/api/v1/system/version")

    assert response.status_code == 200
    assert response.json() == {
        "android_version": "2.0.0",
        "ios_version": "2.0.0",
        "web_version": "2.0.0",
        "download_url": "https://darmavoz.ru/static/darmavoz.apk",
        "force_update": False,
    }


@pytest.mark.asyncio
async def test_logist_can_delete_order_with_items_offers_and_events(client, session_factory):
    async with session_factory() as session:
        logist_role = await ensure_role(session, "logist")
        driver_role = await ensure_role(session, "driver")
        logist_user = await create_user(session, username="delete_order_logist", role=logist_role)
        driver_user = await create_user(session, username="delete_order_driver", role=driver_role)

        category = Category(name="Щебень", slug="delete-order-stone", sort_order=0, is_active=True)
        material = Material(
            category=category,
            name="Щебень",
            description="",
            price=2100.0,
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
        session.add_all([category, material, delivery_option])
        await session.flush()

        vehicle = Vehicle(title="Delete order truck", delivery_option_id=delivery_option.id, is_active=True)
        session.add(vehicle)
        await session.flush()

        driver = Driver(
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            name="Delete Driver",
            phone="+79000009999",
            status=DriverStatus.available.value,
            dispatch_priority=100,
            is_auto_dispatch_enabled=True,
        )
        session.add(driver)
        await session.flush()

        client_record = Client(name="Delete Client", phone="+79995554433")
        session.add(client_record)
        await session.flush()

        order = Order(
            client_id=client_record.id,
            driver_id=driver.id,
            delivery_option_id=delivery_option.id,
            address="Томск, тест удаления",
            total_amount=21000.0,
            status="offered_to_driver",
            source="dispatcher",
            created_by_source="dispatcher",
        )
        session.add(order)
        await session.flush()

        order_item = OrderItem(
            order_id=order.id,
            material_id=material.id,
            quantity=1,
            volume=10.0,
            price=2100.0,
            amount=21000.0,
        )
        session.add(order_item)
        await session.flush()

        order_offer = OrderOffer(
            order_id=order.id,
            driver_id=driver.id,
            price=21000.0,
            sequence_no=1,
            status=OrderOfferStatus.pending.value,
            offered_at=datetime.now(UTC),
            expires_at=datetime.now(UTC) + timedelta(minutes=2),
        )
        session.add(order_offer)
        await session.flush()

        order.current_offer_id = order_offer.id
        session.add(EventLog(order_id=order.id, event_type="driver_offer_created", description="pending"))
        await session.commit()

    response = await client.delete(
        f"/api/v1/orders/{order.id}",
        headers=auth_headers("delete_order_logist"),
    )

    assert response.status_code == 200
    assert response.json()["ok"] is True

    async with session_factory() as session:
        deleted_order = await session.scalar(select(Order).where(Order.id == order.id))
        remaining_items = await session.scalars(select(OrderItem).where(OrderItem.order_id == order.id))
        remaining_offers = await session.scalars(select(OrderOffer).where(OrderOffer.order_id == order.id))
        remaining_events = await session.scalars(select(EventLog).where(EventLog.order_id == order.id))

    assert deleted_order is None
    assert list(remaining_items) == []
    assert list(remaining_offers) == []
    assert list(remaining_events) == []
