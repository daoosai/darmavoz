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
        refreshed_driver_2 = await session.get(Driver, driver_2.id)
        assert refreshed_driver_2 is not None
        refreshed_driver_2.temporary_penalty_until = datetime.now(UTC) + timedelta(minutes=10)
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

    assigned_response = await client.get(
        "/api/v1/driver/orders/assigned/current",
        headers=auth_headers("dispatch_driver_2"),
    )
    assert assigned_response.status_code == 200
    assigned_payload = assigned_response.json()
    assert assigned_payload["order_id"] == order_id
    assert assigned_payload["status"] == OrderStatus.driver_assigned.value
    assert assigned_payload["order"]["status"] == OrderStatus.driver_assigned.value
    assert assigned_payload["order"]["total_amount"] == 20000.0
    assert assigned_payload["order"]["created_at"] is not None
    assert assigned_payload["order"]["items"][0]["material"]["name"] == "Речной песок"
    assert assigned_payload["order"]["delivery_option"]["capacity_m3"] == 10.0

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


@pytest.mark.asyncio
async def test_logist_can_assign_driver_manually_and_driver_sees_assigned_order(client, session_factory):
    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        logist_role = await ensure_role(session, "logist")

        category = Category(name="Щебень", slug="stone-manual-assign", sort_order=0, is_active=True)
        material = Material(
            category=category,
            name="Щебень 20-40",
            description="",
            price=1800.0,
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

        driver_user = await create_driver_user(session, username="manual_assign_driver", role=driver_role)
        logist_user = await create_driver_user(session, username="manual_assign_logist", role=logist_role)

        vehicle = Vehicle(title="Камаз ручной", delivery_option_id=delivery_option.id, is_active=True)
        session.add(vehicle)
        await session.flush()

        driver = Driver(
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            name="Ручной водитель",
            phone="+79000000123",
            status=DriverStatus.available.value,
            dispatch_priority=100,
            is_auto_dispatch_enabled=True,
        )
        session.add(driver)
        await session.commit()
        await session.refresh(material)
        await session.refresh(delivery_option)
        await session.refresh(driver)
        del logist_user

    create_response = await client.post(
        "/api/v1/logist/orders",
        json={
            "client_name": "Петр Смирнов",
            "client_phone": "+79990002233",
            "material_id": str(material.id),
            "delivery_option_id": str(delivery_option.id),
            "address": "Томск, Фрунзе 15",
            "notes": "Подъезд со двора",
            "quantity": 1,
            "auto_dispatch": False,
        },
        headers=auth_headers("manual_assign_logist"),
    )
    assert create_response.status_code == 201
    order_id = create_response.json()["id"]
    assert create_response.json()["status"] == OrderStatus.created.value

    assign_response = await client.post(
        f"/api/v1/orders/{order_id}/assign",
        json={"driver_id": str(driver.id)},
        headers=auth_headers("manual_assign_logist"),
    )
    assert assign_response.status_code == 200
    assign_payload = assign_response.json()
    assert assign_payload["status"] == OrderStatus.driver_assigned.value
    assert assign_payload["driver"]["id"] == str(driver.id)

    assigned_response = await client.get(
        "/api/v1/driver/orders/assigned/current",
        headers=auth_headers("manual_assign_driver"),
    )
    assert assigned_response.status_code == 200
    assigned_payload = assigned_response.json()
    assert assigned_payload["order_id"] == order_id
    assert assigned_payload["status"] == OrderStatus.driver_assigned.value
    assert assigned_payload["order"]["status"] == OrderStatus.driver_assigned.value
    assert assigned_payload["order"]["address"] == "Томск, Фрунзе 15"

    history_response = await client.get(
        f"/api/v1/logist/orders/{order_id}/dispatch-history",
        headers=auth_headers("manual_assign_logist"),
    )
    assert history_response.status_code == 200
    history = history_response.json()
    assert history["assigned_driver_id"] == str(driver.id)
    assert [attempt["status"] for attempt in history["attempts"]] == [OrderOfferStatus.accepted.value]
    assert history["attempts"][0]["decision_reason"] == "Manual assignment by logist"

    async with session_factory() as session:
        order = await session.scalar(select(Order).where(Order.id == order_id))
        assert order is not None
        assert order.status == OrderStatus.driver_assigned.value
        assert order.driver_id == driver.id

        refreshed_driver = await session.get(Driver, driver.id)
        assert refreshed_driver is not None
        assert refreshed_driver.status == DriverStatus.busy.value


@pytest.mark.asyncio
async def test_driver_assigned_current_returns_manually_assigned_order_without_offer_record(client, session_factory):
    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")

        category = Category(name="Песок без оффера", slug="sand-no-offer", sort_order=0, is_active=True)
        material = Material(
            category=category,
            name="Песок карьерный",
            description="",
            price=1500.0,
            unit="m3",
            min_volume=5.0,
            is_active=True,
            sort_order=0,
        )
        delivery_option = DeliveryOption(
            capacity_m3=12.0,
            title="12 м3",
            description="",
            base_price=0.0,
            is_active=True,
            sort_order=0,
        )
        session.add_all([category, material, delivery_option])
        await session.flush()

        driver_user = await create_driver_user(session, username="assigned_no_offer_driver", role=driver_role)
        vehicle = Vehicle(title="Самосвал без оффера", delivery_option_id=delivery_option.id, is_active=True)
        session.add(vehicle)
        await session.flush()

        driver = Driver(
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            name="Водитель без оффера",
            phone="+79000000999",
            status=DriverStatus.busy.value,
            dispatch_priority=100,
            is_auto_dispatch_enabled=True,
        )
        session.add(driver)
        await session.flush()
        client_record = Client(name="Клиент без оффера", phone="+79990009999")
        session.add(client_record)
        await session.flush()

        order = Order(
            client_id=client_record.id,
            driver_id=driver.id,
            delivery_option_id=delivery_option.id,
            address="Томск, Иркутский тракт 1",
            total_amount=18000.0,
            status=OrderStatus.driver_assigned.value,
            source="dispatcher",
            created_by_source="dispatcher",
            assigned_at=datetime.now(UTC),
        )
        session.add(order)
        await session.flush()
        session.add(
            OrderItem(
                order_id=order.id,
                material_id=material.id,
                quantity=1,
                volume=12.0,
                price=1500.0,
                amount=18000.0,
            )
        )
        await session.commit()
        await session.refresh(order)

    assigned_response = await client.get(
        "/api/v1/driver/orders/assigned/current",
        headers=auth_headers("assigned_no_offer_driver"),
    )
    assert assigned_response.status_code == 200
    payload = assigned_response.json()
    assert payload["order_id"] == str(order.id)
    assert payload["status"] == OrderStatus.driver_assigned.value
    assert payload["order"]["status"] == OrderStatus.driver_assigned.value
    assert payload["order"]["address"] == "Томск, Иркутский тракт 1"

    async with session_factory() as session:
        offers = await session.scalars(select(OrderOffer).where(OrderOffer.order_id == order.id))
        assert list(offers) == []


@pytest.mark.asyncio
async def test_decline_immediately_offers_next_driver_even_if_next_driver_is_penalized(client, session_factory):
    fake_redis = FakeRedis()
    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        logist_role = await ensure_role(session, "logist")

        category = Category(name="Щебень", slug="gravel-dispatch", sort_order=0, is_active=True)
        material = Material(
            category=category,
            name="Щебень 5-20",
            description="",
            price=2500.0,
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
        session.add_all([category, material, option_10])
        await session.flush()

        user_1 = await create_driver_user(session, username="decline_driver_1", role=driver_role)
        user_2 = await create_driver_user(session, username="decline_driver_2", role=driver_role)
        await create_driver_user(session, username="decline_logist", role=logist_role)

        vehicle_1 = Vehicle(title="Самосвал 10 м3 #1", delivery_option_id=option_10.id, is_active=True)
        vehicle_2 = Vehicle(title="Самосвал 10 м3 #2", delivery_option_id=option_10.id, is_active=True)
        session.add_all([vehicle_1, vehicle_2])
        await session.flush()

        driver_1 = Driver(
            user_id=user_1.id,
            vehicle_id=vehicle_1.id,
            name="Водитель на первом оффере",
            phone="+79000001001",
            status=DriverStatus.available.value,
            dispatch_priority=200,
            is_auto_dispatch_enabled=True,
        )
        driver_2 = Driver(
            user_id=user_2.id,
            vehicle_id=vehicle_2.id,
            name="Водитель со штрафом",
            phone="+79000001002",
            status=DriverStatus.available.value,
            dispatch_priority=100,
            is_auto_dispatch_enabled=True,
            temporary_penalty_until=datetime.now(UTC) + timedelta(minutes=15),
        )
        session.add_all([driver_1, driver_2])
        await session.commit()
        await session.refresh(material)
        await session.refresh(option_10)
        await session.refresh(driver_1)
        await session.refresh(driver_2)

    response = await client.post(
        "/api/v1/logist/orders",
        json={
            "client_name": "Петр Сидоров",
            "client_phone": "+79990002233",
            "material_id": str(material.id),
            "delivery_option_id": str(option_10.id),
            "address": "Томск, Учебная 15",
            "notes": "Тест decline",
            "quantity": 1,
            "auto_dispatch": True,
        },
        headers=auth_headers("decline_logist"),
    )
    assert response.status_code == 201
    order_id = response.json()["id"]

    processed = await run_dispatch_tick(fake_redis, session_factory)
    assert processed >= 1

    incoming_driver_1 = await client.get(
        "/api/v1/driver/orders/incoming/current",
        headers=auth_headers("decline_driver_1"),
    )
    first_offer = incoming_driver_1.json()
    assert first_offer["order_id"] == order_id

    decline_response = await client.post(
        f"/api/v1/driver/order-offers/{first_offer['offer_id']}/decline",
        json={"reason": "manual"},
        headers=auth_headers("decline_driver_1"),
    )
    assert decline_response.status_code == 200
    assert decline_response.json()["offer_status"] == "declined"
    assert decline_response.json()["order_status"] == OrderStatus.offered_to_driver.value
    assert decline_response.json()["next_attempt_started"] is True

    incoming_driver_2 = await client.get(
        "/api/v1/driver/orders/incoming/current",
        headers=auth_headers("decline_driver_2"),
    )
    second_offer = incoming_driver_2.json()
    assert second_offer["order_id"] == order_id

    history_response = await client.get(
        f"/api/v1/logist/orders/{order_id}/dispatch-history",
        headers=auth_headers("decline_logist"),
    )
    assert history_response.status_code == 200
    history = history_response.json()
    assert [attempt["status"] for attempt in history["attempts"]] == [
        OrderOfferStatus.declined.value,
        OrderOfferStatus.pending.value,
    ]


@pytest.mark.asyncio
async def test_logist_redispatch_restarts_search_and_reuses_previous_candidates(client, session_factory):
    fake_redis = FakeRedis()
    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        logist_role = await ensure_role(session, "logist")

        category = Category(name="ПГС", slug="redispatch-dispatch", sort_order=0, is_active=True)
        material = Material(
            category=category,
            name="ПГС",
            description="",
            price=1800.0,
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
        session.add_all([category, material, option_10])
        await session.flush()

        user_1 = await create_driver_user(session, username="redispatch_driver_1", role=driver_role)
        user_2 = await create_driver_user(session, username="redispatch_driver_2", role=driver_role)
        await create_driver_user(session, username="redispatch_logist", role=logist_role)

        vehicle_1 = Vehicle(title="Камаз redispatch #1", delivery_option_id=option_10.id, is_active=True)
        vehicle_2 = Vehicle(title="Камаз redispatch #2", delivery_option_id=option_10.id, is_active=True)
        session.add_all([vehicle_1, vehicle_2])
        await session.flush()

        driver_1 = Driver(
            user_id=user_1.id,
            vehicle_id=vehicle_1.id,
            name="Redispatch Driver 1",
            phone="+79000002001",
            status=DriverStatus.available.value,
            dispatch_priority=200,
            is_auto_dispatch_enabled=True,
        )
        driver_2 = Driver(
            user_id=user_2.id,
            vehicle_id=vehicle_2.id,
            name="Redispatch Driver 2",
            phone="+79000002002",
            status=DriverStatus.available.value,
            dispatch_priority=100,
            is_auto_dispatch_enabled=True,
        )
        session.add_all([driver_1, driver_2])
        await session.commit()
        await session.refresh(material)
        await session.refresh(option_10)
        await session.refresh(driver_1)
        await session.refresh(driver_2)

    response = await client.post(
        "/api/v1/logist/orders",
        json={
            "client_name": "Мария Смирнова",
            "client_phone": "+79990003344",
            "material_id": str(material.id),
            "delivery_option_id": str(option_10.id),
            "address": "Томск, Советская 7",
            "notes": "Тест redispatch",
            "quantity": 1,
            "auto_dispatch": True,
        },
        headers=auth_headers("redispatch_logist"),
    )
    assert response.status_code == 201
    order_id = response.json()["id"]

    processed = await run_dispatch_tick(fake_redis, session_factory)
    assert processed >= 1

    first_offer = (
        await client.get(
            "/api/v1/driver/orders/incoming/current",
            headers=auth_headers("redispatch_driver_1"),
        )
    ).json()
    assert first_offer["order_id"] == order_id

    decline_first = await client.post(
        f"/api/v1/driver/order-offers/{first_offer['offer_id']}/decline",
        json={"reason": "manual"},
        headers=auth_headers("redispatch_driver_1"),
    )
    assert decline_first.status_code == 200

    second_offer = (
        await client.get(
            "/api/v1/driver/orders/incoming/current",
            headers=auth_headers("redispatch_driver_2"),
        )
    ).json()
    assert second_offer["order_id"] == order_id

    decline_second = await client.post(
        f"/api/v1/driver/order-offers/{second_offer['offer_id']}/decline",
        json={"reason": "manual"},
        headers=auth_headers("redispatch_driver_2"),
    )
    assert decline_second.status_code == 200
    assert decline_second.json()["order_status"] == OrderStatus.no_driver_found.value

    redispatch_response = await client.post(
        f"/api/v1/logist/orders/{order_id}/redispatch",
        headers=auth_headers("redispatch_logist"),
    )
    assert redispatch_response.status_code == 200
    assert redispatch_response.json()["status"] == OrderStatus.offered_to_driver.value

    incoming_after_redispatch = await client.get(
        "/api/v1/driver/orders/incoming/current",
        headers=auth_headers("redispatch_driver_1"),
    )
    assert incoming_after_redispatch.status_code == 200
    assert incoming_after_redispatch.json()["order_id"] == order_id

    history_response = await client.get(
        f"/api/v1/logist/orders/{order_id}/dispatch-history",
        headers=auth_headers("redispatch_logist"),
    )
    history = history_response.json()
    statuses = [attempt["status"] for attempt in history["attempts"]]
    assert statuses[:2] == [
        OrderOfferStatus.declined.value,
        OrderOfferStatus.declined.value,
    ]
    assert statuses[-1] == OrderOfferStatus.pending.value


@pytest.mark.asyncio
async def test_decline_finishes_with_no_driver_found_when_unique_candidates_are_exhausted(client, session_factory):
    fake_redis = FakeRedis()
    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        logist_role = await ensure_role(session, "logist")

        category = Category(name="Грунт", slug="retry-previous-driver", sort_order=0, is_active=True)
        material = Material(
            category=category,
            name="Грунт",
            description="",
            price=1500.0,
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
        session.add_all([category, material, option_10])
        await session.flush()

        user_1 = await create_driver_user(session, username="retry_chain_driver_1", role=driver_role)
        user_2 = await create_driver_user(session, username="retry_chain_driver_2", role=driver_role)
        await create_driver_user(session, username="retry_chain_logist", role=logist_role)

        vehicle_1 = Vehicle(title="Retry chain 10 м3 #1", delivery_option_id=option_10.id, is_active=True)
        vehicle_2 = Vehicle(title="Retry chain 10 м3 #2", delivery_option_id=option_10.id, is_active=True)
        session.add_all([vehicle_1, vehicle_2])
        await session.flush()

        driver_1 = Driver(
            user_id=user_1.id,
            vehicle_id=vehicle_1.id,
            name="Retry Driver 1",
            phone="+79000003001",
            status=DriverStatus.available.value,
            dispatch_priority=200,
            is_auto_dispatch_enabled=True,
        )
        driver_2 = Driver(
            user_id=user_2.id,
            vehicle_id=vehicle_2.id,
            name="Retry Driver 2",
            phone="+79000003002",
            status=DriverStatus.available.value,
            dispatch_priority=100,
            is_auto_dispatch_enabled=True,
        )
        session.add_all([driver_1, driver_2])
        await session.commit()
        await session.refresh(material)
        await session.refresh(option_10)
        await session.refresh(driver_1)
        await session.refresh(driver_2)

    response = await client.post(
        "/api/v1/logist/orders",
        json={
            "client_name": "Алексей Орлов",
            "client_phone": "+79990004455",
            "material_id": str(material.id),
            "delivery_option_id": str(option_10.id),
            "address": "Томск, Киевская 1",
            "notes": "Тест retry exhausted chain",
            "quantity": 1,
            "auto_dispatch": True,
        },
        headers=auth_headers("retry_chain_logist"),
    )
    assert response.status_code == 201
    order_id = response.json()["id"]

    processed = await run_dispatch_tick(fake_redis, session_factory)
    assert processed >= 1

    first_offer_payload = (
        await client.get(
            "/api/v1/driver/orders/incoming/current",
            headers=auth_headers("retry_chain_driver_1"),
        )
    ).json()
    assert first_offer_payload["order_id"] == order_id

    async with session_factory() as session:
        first_offer = await session.scalar(
            select(OrderOffer).where(OrderOffer.id == first_offer_payload["offer_id"])
        )
        assert first_offer is not None
        first_offer.expires_at = datetime.now(UTC) - timedelta(seconds=5)
        await session.commit()

    processed = await run_dispatch_tick(fake_redis, session_factory)
    assert processed >= 1

    second_offer_payload = (
        await client.get(
            "/api/v1/driver/orders/incoming/current",
            headers=auth_headers("retry_chain_driver_2"),
        )
    ).json()
    assert second_offer_payload["order_id"] == order_id

    decline_response = await client.post(
        f"/api/v1/driver/order-offers/{second_offer_payload['offer_id']}/decline",
        json={"reason": "manual"},
        headers=auth_headers("retry_chain_driver_2"),
    )
    assert decline_response.status_code == 200
    assert decline_response.json()["order_status"] == OrderStatus.no_driver_found.value

    retried_offer_payload = (
        await client.get(
            "/api/v1/driver/orders/incoming/current",
            headers=auth_headers("retry_chain_driver_1"),
        )
    ).json()
    assert retried_offer_payload["order_id"] is None

    order_response = await client.get(
        f"/api/v1/logist/orders/{order_id}",
        headers=auth_headers("retry_chain_logist"),
    )
    assert order_response.status_code == 200
    assert order_response.json()["status"] == OrderStatus.no_driver_found.value

    history_response = await client.get(
        f"/api/v1/logist/orders/{order_id}/dispatch-history",
        headers=auth_headers("retry_chain_logist"),
    )
    history = history_response.json()
    assert [attempt["status"] for attempt in history["attempts"]] == [
        OrderOfferStatus.expired.value,
        OrderOfferStatus.declined.value,
    ]
