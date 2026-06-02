from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models.models import (
    Category,
    DeliveryOption,
    Driver,
    DriverStatus,
    Material,
    Order,
    OrderOffer,
    OrderOfferStatus,
    OrderStatus,
    Role,
    User,
    Vehicle,
)
from app.security.auth import get_password_hash
from app.security.jwt import create_access_token
from app.services.dispatch_worker import run_dispatch_tick


class FakeRedis:
    def __init__(self) -> None:
        self.keys: set[str] = set()

    async def set(self, key: str, value: str, ex: int, nx: bool) -> bool:
        if nx and key in self.keys:
            return False
        self.keys.add(key)
        return True

    async def delete(self, key: str) -> None:
        self.keys.discard(key)


async def ensure_role(session, name: str) -> Role:
    role = await session.scalar(select(Role).where(Role.name == name))
    if role is None:
        role = Role(name=name, description=name)
        session.add(role)
        await session.flush()
    return role


async def create_driver_user(session, *, username: str, role: Role) -> User:
    user = User(
        username=username,
        hashed_password=get_password_hash("secret"),
        role_id=role.id,
        is_active=True,
    )
    session.add(user)
    await session.flush()
    return user


def auth_headers(username: str) -> dict[str, str]:
    token = create_access_token(data={"sub": username})
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_dispatch_skips_wrong_vehicle_and_moves_to_next_driver(client, session_factory):
    fake_redis = FakeRedis()
    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        logist_role = await ensure_role(session, "logist")

        category = Category(name="Песок", slug="sand-dispatch", sort_order=0, is_active=True)
        material = Material(
            category=category,
            name="Речной песок",
            description="",
            price=2000.0,
            unit="m3",
            min_volume=5.0,
            is_active=True,
            sort_order=0,
        )
        option_10 = DeliveryOption(
            capacity_m3=10.0,
            title="10 м3",
            description="",
            base_price=0.0,
            is_active=True,
            sort_order=0,
        )
        option_20 = DeliveryOption(
            capacity_m3=20.0,
            title="20 м3",
            description="",
            base_price=0.0,
            is_active=True,
            sort_order=1,
        )
        session.add_all([category, material, option_10, option_20])
        await session.flush()

        user_1 = await create_driver_user(session, username="dispatch_driver_1", role=driver_role)
        user_2 = await create_driver_user(session, username="dispatch_driver_2", role=driver_role)
        user_3 = await create_driver_user(session, username="dispatch_driver_3", role=driver_role)
        logist_user = await create_driver_user(session, username="dispatch_logist", role=logist_role)

        vehicle_1 = Vehicle(title="Камаз 10 м3 #1", delivery_option_id=option_10.id, is_active=True)
        vehicle_2 = Vehicle(title="Камаз 10 м3 #2", delivery_option_id=option_10.id, is_active=True)
        vehicle_3 = Vehicle(title="Камаз 20 м3", delivery_option_id=option_20.id, is_active=True)
        session.add_all([vehicle_1, vehicle_2, vehicle_3])
        await session.flush()

        driver_1 = Driver(
            user_id=user_1.id,
            vehicle_id=vehicle_1.id,
            name="Водитель 1",
            phone="+79000000001",
            status=DriverStatus.available.value,
            dispatch_priority=200,
            is_auto_dispatch_enabled=True,
        )
        driver_2 = Driver(
            user_id=user_2.id,
            vehicle_id=vehicle_2.id,
            name="Водитель 2",
            phone="+79000000002",
            status=DriverStatus.available.value,
            dispatch_priority=100,
            is_auto_dispatch_enabled=True,
        )
        driver_3 = Driver(
            user_id=user_3.id,
            vehicle_id=vehicle_3.id,
            name="Водитель 3",
            phone="+79000000003",
            status=DriverStatus.available.value,
            dispatch_priority=300,
            is_auto_dispatch_enabled=True,
        )
        session.add_all([driver_1, driver_2, driver_3])
        await session.commit()
        await session.refresh(material)
        await session.refresh(option_10)
        await session.refresh(driver_1)
        await session.refresh(driver_2)
        await session.refresh(driver_3)

    response = await client.post(
        "/api/v1/logist/orders",
        json={
            "client_name": "Иван Петров",
            "client_phone": "+79990001122",
            "material_id": str(material.id),
            "delivery_option_id": str(option_10.id),
            "address": "Томск, Ленина 10",
            "notes": "Позвонить заранее",
            "quantity": 1,
            "auto_dispatch": True,
        },
        headers=auth_headers("dispatch_logist"),
    )
    assert response.status_code == 201
    order_id = response.json()["id"]
    assert response.json()["status"] == OrderStatus.searching_driver.value

    processed = await run_dispatch_tick(fake_redis, session_factory)
    assert processed >= 1

    incoming_driver_1 = await client.get(
        "/api/v1/driver/orders/incoming/current",
        headers=auth_headers("dispatch_driver_1"),
    )
    assert incoming_driver_1.status_code == 200
    payload_1 = incoming_driver_1.json()
    assert payload_1["order_id"] == order_id
    assert payload_1["order"]["delivery_option"]["capacity_m3"] == 10.0

    incoming_driver_3 = await client.get(
        "/api/v1/driver/orders/incoming/current",
        headers=auth_headers("dispatch_driver_3"),
    )
    assert incoming_driver_3.status_code == 200
    assert incoming_driver_3.json()["offer_id"] is None

    async with session_factory() as session:
        first_offer = await session.scalar(select(OrderOffer).where(OrderOffer.order_id == order_id))
        assert first_offer is not None
        assert first_offer.driver_id == driver_1.id
        first_offer.expires_at = datetime.now(UTC) - timedelta(seconds=5)
        await session.commit()

    processed = await run_dispatch_tick(fake_redis, session_factory)
    assert processed >= 1

    incoming_driver_1_after = await client.get(
        "/api/v1/driver/orders/incoming/current",
        headers=auth_headers("dispatch_driver_1"),
    )
    assert incoming_driver_1_after.json()["offer_id"] is None

    incoming_driver_2 = await client.get(
        "/api/v1/driver/orders/incoming/current",
        headers=auth_headers("dispatch_driver_2"),
    )
    second_offer_payload = incoming_driver_2.json()
    assert second_offer_payload["order_id"] == order_id

    accept_response = await client.post(
        f"/api/v1/driver/order-offers/{second_offer_payload['offer_id']}/accept",
        headers=auth_headers("dispatch_driver_2"),
    )
    assert accept_response.status_code == 200
    assert accept_response.json()["offer_status"] == "accepted"
    assert accept_response.json()["order_status"] == OrderStatus.driver_assigned.value

    history_response = await client.get(
        f"/api/v1/logist/orders/{order_id}/dispatch-history",
        headers=auth_headers("dispatch_logist"),
    )
    assert history_response.status_code == 200
    history = history_response.json()
    assert history["assigned_driver_id"] == str(driver_2.id)
    assert [attempt["status"] for attempt in history["attempts"]] == [
        OrderOfferStatus.expired.value,
        OrderOfferStatus.accepted.value,
    ]

    async with session_factory() as session:
        order = await session.scalar(select(Order).where(Order.id == order_id))
        assert order is not None
        assert order.status == OrderStatus.driver_assigned.value
        assert order.driver_id == driver_2.id

        refreshed_driver_2 = await session.get(Driver, driver_2.id)
        assert refreshed_driver_2 is not None
        assert refreshed_driver_2.status == DriverStatus.busy.value
