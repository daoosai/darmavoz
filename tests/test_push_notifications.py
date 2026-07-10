import asyncio
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.models import (
    Client,
    DeliveryOption,
    Driver,
    DriverStatus,
    Material,
    ModerationStatus,
    Order,
    OrderItem,
    OrderOffer,
    OrderOfferStatus,
    OrderStatus,
    Role,
    User,
    Vehicle,
)
from app.security.auth import get_password_hash
from app.security.jwt import create_access_token
from app.services.dispatch_service import expire_offer, get_orders_needing_dispatch, process_dispatch_for_order


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
async def test_driver_can_save_and_clear_fcm_token(client, session_factory):
    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        driver_user = await create_user(session, username="+79990030101", role=driver_role)
        driver = Driver(
            name="FCM Driver",
            phone="+79990030101",
            user_id=driver_user.id,
            status=DriverStatus.offline.value,
            moderation_status=ModerationStatus.incomplete.value,
        )
        session.add(driver)
        await session.commit()

    save_response = await client.post(
        "/api/v1/driver/fcm-token",
        headers=auth_headers("+79990030101"),
        json={"token": "fcm-token-123"},
    )
    assert save_response.status_code == 200
    assert save_response.json() == {"ok": True, "token": "fcm-token-123"}

    async with session_factory() as session:
        driver = await session.scalar(select(Driver).where(Driver.phone == "+79990030101"))
        assert driver is not None
        assert driver.fcm_token == "fcm-token-123"

    delete_response = await client.delete(
        "/api/v1/driver/fcm-token",
        headers=auth_headers("+79990030101"),
    )
    assert delete_response.status_code == 200
    assert delete_response.json() == {"ok": True, "token": None}

    async with session_factory() as session:
        driver = await session.scalar(select(Driver).where(Driver.phone == "+79990030101"))
        assert driver is not None
        assert driver.fcm_token is None


@pytest.mark.asyncio
async def test_client_can_save_and_clear_fcm_token(client, session_factory):
    async with session_factory() as session:
        client_row = Client(name="FCM Client", phone="+79990030111")
        session.add(client_row)
        await session.commit()
        client_id = client_row.id

    token = create_access_token(
        data={
            "sub": "+79990030111",
            "role": "client",
            "client_id": str(client_id),
        }
    )
    headers = {"Authorization": f"Bearer {token}"}

    save_response = await client.post(
        "/api/v1/clients/me/fcm-token",
        headers=headers,
        json={"token": "client-token-123"},
    )
    assert save_response.status_code == 200
    assert save_response.json() == {"ok": True, "token": "client-token-123"}

    async with session_factory() as session:
        updated_client = await session.scalar(select(Client).where(Client.id == client_id))
        assert updated_client is not None
        assert updated_client.fcm_token == "client-token-123"

    delete_response = await client.delete("/api/v1/clients/me/fcm-token", headers=headers)
    assert delete_response.status_code == 200
    assert delete_response.json() == {"ok": True, "token": None}

    async with session_factory() as session:
        updated_client = await session.scalar(select(Client).where(Client.id == client_id))
        assert updated_client is not None
        assert updated_client.fcm_token is None


@pytest.mark.asyncio
async def test_manual_assign_schedules_client_and_driver_notifications(client, session_factory, monkeypatch):
    sent_notifications: list[tuple[str, str, str]] = []

    def fake_schedule_driver_new_order(order, driver_id):
        sent_notifications.append(("driver", str(driver_id), order.status))

    def fake_schedule_client_assigned(order):
        sent_notifications.append(("client", str(order.client_id), order.status))

    monkeypatch.setattr(
        "app.services.dispatch_service.schedule_driver_new_order_notification",
        fake_schedule_driver_new_order,
    )
    monkeypatch.setattr(
        "app.services.dispatch_service.schedule_client_driver_assigned_notification",
        fake_schedule_client_assigned,
    )

    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        driver_role = await ensure_role(session, "driver")
        admin_user = await create_user(session, username="push_admin", role=admin_role)
        driver_user = await create_user(session, username="+79990030102", role=driver_role)
        from app.models.models import Category

        category = Category(name="Bulk", slug="bulk-test-push", sort_order=0, is_active=True)
        delivery_option = DeliveryOption(
            capacity_m3=10.0,
            title="Truck 10m3",
            description="",
            base_price=5000.0,
            is_active=True,
            sort_order=0,
        )
        session.add_all([category, delivery_option])
        await session.flush()
        material = Material(
            category_id=category.id,
            name="Gravel",
            description="",
            price=1000.0,
            unit="m3",
            min_volume=1.0,
            is_active=True,
            sort_order=0,
        )
        vehicle = Vehicle(
            title="Push Truck",
            brand="KamAZ",
            plate_number="A123AA72",
            vehicle_type="Dump truck",
            cubature_max=10.0,
            delivery_option_id=delivery_option.id,
            is_active=True,
            moderation_status=ModerationStatus.approved.value,
        )
        session.add(vehicle)
        await session.flush()
        driver = Driver(
            name="Busy Driver",
            phone="+79990030102",
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            status=DriverStatus.available.value,
            moderation_status=ModerationStatus.approved.value,
        )
        client_row = Client(name="Client", phone="+79990039999")
        session.add_all([driver, client_row])
        await session.flush()
        session.add(material)
        await session.flush()

        order = Order(
            client_id=client_row.id,
            delivery_option_id=delivery_option.id,
            address="Test address",
            delivery_address="Test address",
            total_amount=10000.0,
            status=OrderStatus.created.value,
            source="dispatcher",
            created_by_source="dispatcher",
            created_at=datetime.now(UTC),
        )
        session.add(order)
        await session.flush()
        session.add(
            OrderItem(
                order_id=order.id,
                material_id=material.id,
                quantity=1,
                volume=10.0,
                price=1000.0,
                amount=10000.0,
            )
        )
        await session.commit()
        order_id = order.id
        driver_id = driver.id
        driver_id = driver.id
        client_id = client_row.id

    response = await client.post(
        f"/api/v1/orders/{order_id}/assign",
        headers=auth_headers(admin_user.username),
        json={"driver_id": str(driver_id)},
    )
    assert response.status_code == 200
    assert sent_notifications == [
        ("client", str(client_id), OrderStatus.driver_assigned.value),
        ("driver", str(driver_id), OrderStatus.driver_assigned.value),
    ]


@pytest.mark.asyncio
async def test_auto_dispatch_schedules_driver_notification(session_factory, monkeypatch):
    sent_driver_ids: list[str] = []

    def fake_schedule_driver_new_order(order, driver_id):
        sent_driver_ids.append(str(driver_id))
        assert order.status == OrderStatus.offered_to_driver.value

    monkeypatch.setattr(
        "app.services.dispatch_service.schedule_driver_new_order_notification",
        fake_schedule_driver_new_order,
    )

    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        driver_user = await create_user(session, username="+79990030103", role=driver_role)
        from app.models.models import Category

        category = Category(name="Sand", slug="sand-push-test", sort_order=0, is_active=True)
        delivery_option = DeliveryOption(
            capacity_m3=20.0,
            title="Truck 20m3",
            description="",
            base_price=7000.0,
            is_active=True,
            sort_order=0,
        )
        session.add_all([category, delivery_option])
        await session.flush()
        material = Material(
            category_id=category.id,
            name="Sand",
            description="",
            price=500.0,
            unit="m3",
            min_volume=1.0,
            is_active=True,
            sort_order=0,
        )
        vehicle = Vehicle(
            title="Dispatch Truck",
            brand="MAN",
            plate_number="B456BB72",
            delivery_option_id=delivery_option.id,
            is_active=True,
            moderation_status=ModerationStatus.approved.value,
        )
        session.add_all([material, vehicle])
        await session.flush()
        driver = Driver(
            name="Auto Dispatch Driver",
            phone="+79990030103",
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            status=DriverStatus.available.value,
            moderation_status=ModerationStatus.approved.value,
            is_auto_dispatch_enabled=True,
            fcm_token="auto-token",
        )
        client_row = Client(name="Client 2", phone="+79990038888")
        session.add_all([driver, client_row])
        await session.flush()
        order = Order(
            client_id=client_row.id,
            delivery_option_id=delivery_option.id,
            address="Auto address",
            delivery_address="Auto address",
            total_amount=10000.0,
            status=OrderStatus.searching_driver.value,
            source="dispatcher",
            created_by_source="dispatcher",
            dispatch_started_at=datetime.now(UTC),
        )
        session.add(order)
        await session.flush()
        session.add(
            OrderItem(
                order_id=order.id,
                material_id=material.id,
                quantity=1,
                volume=20.0,
                price=500.0,
                amount=10000.0,
            )
        )
        await session.commit()
        order_id = order.id
        driver_id = driver.id

    async with session_factory() as session:
        await process_dispatch_for_order(session, order_id)
        await asyncio.sleep(0)
        order = await session.scalar(select(Order).where(Order.id == order_id))

    assert order is not None
    assert order.status == OrderStatus.offered_to_driver.value
    assert sent_driver_ids == [str(driver_id)]


@pytest.mark.asyncio
async def test_update_admin_order_on_active_assignment_schedules_driver_change_notification(
    client,
    session_factory,
    monkeypatch,
):
    sent_notifications: list[tuple[str, float, str]] = []

    def fake_schedule_driver_order_changed(order, driver_id):
        sent_notifications.append((str(driver_id), float(order.total_amount), order.delivery_address))

    monkeypatch.setattr(
        "app.services.dispatch_service.schedule_driver_order_changed_notification",
        fake_schedule_driver_order_changed,
    )

    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        driver_role = await ensure_role(session, "driver")
        admin_user = await create_user(session, username="push_order_admin", role=admin_role)
        driver_user = await create_user(session, username="+79990030104", role=driver_role)
        from app.models.models import Category

        category = Category(name="Crushed Stone", slug="stone-push-update", sort_order=0, is_active=True)
        delivery_option = DeliveryOption(
            capacity_m3=12.0,
            title="Truck 12m3",
            description="",
            base_price=6000.0,
            is_active=True,
            sort_order=0,
        )
        session.add_all([category, delivery_option])
        await session.flush()
        material = Material(
            category_id=category.id,
            name="Stone",
            description="",
            price=1000.0,
            unit="m3",
            min_volume=1.0,
            is_active=True,
            sort_order=0,
        )
        vehicle = Vehicle(
            title="Assigned Truck",
            brand="KamAZ",
            plate_number="C789CC72",
            delivery_option_id=delivery_option.id,
            is_active=True,
            moderation_status=ModerationStatus.approved.value,
        )
        session.add_all([material, vehicle])
        await session.flush()
        driver = Driver(
            name="Driver Update",
            phone="+79990030104",
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            status=DriverStatus.busy.value,
            moderation_status=ModerationStatus.approved.value,
        )
        client_row = Client(name="Updated Client", phone="+79990039990")
        session.add_all([driver, client_row])
        await session.flush()
        order = Order(
            client_id=client_row.id,
            driver_id=driver.id,
            delivery_option_id=delivery_option.id,
            address="Старый адрес",
            delivery_address="Старый адрес",
            total_amount=12000.0,
            status=OrderStatus.driver_assigned.value,
            source="dispatcher",
            created_by_source="dispatcher",
            created_at=datetime.now(UTC),
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
                price=1000.0,
                amount=12000.0,
            )
        )
        await session.commit()
        order_id = order.id

    response = await client.patch(
        f"/api/v1/admin/orders/{order_id}",
        headers=auth_headers(admin_user.username),
        json={"delivery_address": "Новый адрес", "total_amount": 13500},
    )

    assert response.status_code == 200
    assert response.json()["delivery_address"] == "Новый адрес"
    assert response.json()["total_amount"] == 13500.0
    assert sent_notifications == [(str(response.json()["driver_id"]), 13500.0, "Новый адрес")]


@pytest.mark.asyncio
async def test_update_admin_order_does_not_schedule_driver_change_on_noop_amount(
    client,
    session_factory,
    monkeypatch,
):
    sent_notifications: list[str] = []

    def fake_schedule_driver_order_changed(order, driver_id):
        sent_notifications.append(str(driver_id))

    monkeypatch.setattr(
        "app.services.dispatch_service.schedule_driver_order_changed_notification",
        fake_schedule_driver_order_changed,
    )

    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        driver_role = await ensure_role(session, "driver")
        admin_user = await create_user(session, username="push_noop_admin", role=admin_role)
        driver_user = await create_user(session, username="+79990030105", role=driver_role)
        from app.models.models import Category

        category = Category(name="Noop", slug="noop-push-update", sort_order=0, is_active=True)
        delivery_option = DeliveryOption(
            capacity_m3=10.0,
            title="Truck 10m3 noop",
            description="",
            base_price=5000.0,
            is_active=True,
            sort_order=0,
        )
        session.add_all([category, delivery_option])
        await session.flush()
        material = Material(
            category_id=category.id,
            name="Noop sand",
            description="",
            price=1000.0,
            unit="m3",
            min_volume=1.0,
            is_active=True,
            sort_order=0,
        )
        vehicle = Vehicle(
            title="Noop Truck",
            brand="MAN",
            plate_number="D111DD72",
            delivery_option_id=delivery_option.id,
            is_active=True,
            moderation_status=ModerationStatus.approved.value,
        )
        session.add_all([material, vehicle])
        await session.flush()
        driver = Driver(
            name="Driver Noop",
            phone="+79990030105",
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            status=DriverStatus.busy.value,
            moderation_status=ModerationStatus.approved.value,
        )
        client_row = Client(name="Noop Client", phone="+79990039991")
        session.add_all([driver, client_row])
        await session.flush()
        order = Order(
            client_id=client_row.id,
            driver_id=driver.id,
            delivery_option_id=delivery_option.id,
            address="Без изменений",
            delivery_address="Без изменений",
            total_amount=10000.0,
            status=OrderStatus.driver_assigned.value,
            source="dispatcher",
            created_by_source="dispatcher",
            created_at=datetime.now(UTC),
            assigned_at=datetime.now(UTC),
        )
        session.add(order)
        await session.flush()
        session.add(
            OrderItem(
                order_id=order.id,
                material_id=material.id,
                quantity=1,
                volume=10.0,
                price=1000.0,
                amount=10000.0,
            )
        )
        await session.commit()
        order_id = order.id

    response = await client.patch(
        f"/api/v1/admin/orders/{order_id}",
        headers=auth_headers(admin_user.username),
        json={"total_amount": 10000},
    )

    assert response.status_code == 200
    assert sent_notifications == []


@pytest.mark.asyncio
async def test_decline_offer_schedules_logist_rejection_notification(client, session_factory, monkeypatch):
    sent_notifications: list[tuple[str, str, str | None]] = []

    def fake_schedule_logist_driver_rejected(order, driver_id, driver_name=None):
        sent_notifications.append((str(order.id), str(driver_id), driver_name))

    monkeypatch.setattr(
        "app.services.dispatch_service.schedule_logist_driver_rejected_notification",
        fake_schedule_logist_driver_rejected,
    )

    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        driver_user = await create_user(session, username="+79990030106", role=driver_role)
        from app.models.models import Category

        category = Category(name="Reject", slug="reject-push-test", sort_order=0, is_active=True)
        delivery_option = DeliveryOption(
            capacity_m3=15.0,
            title="Truck 15m3",
            description="",
            base_price=7000.0,
            is_active=True,
            sort_order=0,
        )
        session.add_all([category, delivery_option])
        await session.flush()
        material = Material(
            category_id=category.id,
            name="Reject sand",
            description="",
            price=500.0,
            unit="m3",
            min_volume=1.0,
            is_active=True,
            sort_order=0,
        )
        vehicle = Vehicle(
            title="Reject Truck",
            brand="MAZ",
            plate_number="E222EE72",
            delivery_option_id=delivery_option.id,
            is_active=True,
            moderation_status=ModerationStatus.approved.value,
        )
        session.add_all([material, vehicle])
        await session.flush()
        driver = Driver(
            name="Decline Driver",
            phone="+79990030106",
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            status=DriverStatus.available.value,
            moderation_status=ModerationStatus.approved.value,
            is_auto_dispatch_enabled=True,
            fcm_token="decline-driver-token",
        )
        client_row = Client(name="Reject Client", phone="+79990039992")
        session.add_all([driver, client_row])
        await session.flush()
        order = Order(
            client_id=client_row.id,
            delivery_option_id=delivery_option.id,
            address="Reject address",
            delivery_address="Reject address",
            total_amount=7500.0,
            status=OrderStatus.searching_driver.value,
            source="dispatcher",
            created_by_source="dispatcher",
            dispatch_started_at=datetime.now(UTC),
        )
        session.add(order)
        await session.flush()
        session.add(
            OrderItem(
                order_id=order.id,
                material_id=material.id,
                quantity=1,
                volume=15.0,
                price=500.0,
                amount=7500.0,
            )
        )
        await session.commit()
        order_id = order.id

    async with session_factory() as session:
        await process_dispatch_for_order(session, order_id)
        await session.commit()
        offer = await session.scalar(select(OrderOffer).where(OrderOffer.order_id == order_id))
        assert offer is not None
        offer_id = offer.id

    response = await client.post(
        f"/api/v1/driver/order-offers/{offer_id}/decline",
        headers=auth_headers(driver_user.username),
        json={"reason": "Не могу взять"},
    )

    assert response.status_code == 200
    assert len(sent_notifications) == 1
    assert sent_notifications[0][0] == str(order_id)
    assert sent_notifications[0][2] == "Decline Driver"


@pytest.mark.asyncio
async def test_expire_offer_schedules_logist_timeout_notification(session_factory, monkeypatch):
    sent_notifications: list[tuple[str, str, str]] = []

    def fake_schedule_logist_timeout(order, driver_id):
        sent_notifications.append((str(order.id), str(driver_id), order.status))

    monkeypatch.setattr(
        "app.services.dispatch_service.schedule_logist_timeout_notification",
        fake_schedule_logist_timeout,
    )

    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        driver_user = await create_user(session, username="+79990030107", role=driver_role)
        from app.models.models import Category

        category = Category(name="Timeout", slug="timeout-push-test", sort_order=0, is_active=True)
        delivery_option = DeliveryOption(
            capacity_m3=18.0,
            title="Truck 18m3",
            description="",
            base_price=7000.0,
            is_active=True,
            sort_order=0,
        )
        session.add_all([category, delivery_option])
        await session.flush()
        material = Material(
            category_id=category.id,
            name="Timeout sand",
            description="",
            price=500.0,
            unit="m3",
            min_volume=1.0,
            is_active=True,
            sort_order=0,
        )
        vehicle = Vehicle(
            title="Timeout Truck",
            brand="Volvo",
            plate_number="F333FF72",
            delivery_option_id=delivery_option.id,
            is_active=True,
            moderation_status=ModerationStatus.approved.value,
        )
        session.add_all([material, vehicle])
        await session.flush()
        driver = Driver(
            name="Timeout Driver",
            phone="+79990030107",
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            status=DriverStatus.available.value,
            moderation_status=ModerationStatus.approved.value,
            is_auto_dispatch_enabled=True,
            fcm_token="timeout-driver-token",
        )
        client_row = Client(name="Timeout Client", phone="+79990039993")
        session.add_all([driver, client_row])
        await session.flush()
        order = Order(
            client_id=client_row.id,
            delivery_option_id=delivery_option.id,
            address="Timeout address",
            delivery_address="Timeout address",
            total_amount=9000.0,
            status=OrderStatus.searching_driver.value,
            source="dispatcher",
            created_by_source="dispatcher",
            dispatch_started_at=datetime.now(UTC),
        )
        session.add(order)
        await session.flush()
        session.add(
            OrderItem(
                order_id=order.id,
                material_id=material.id,
                quantity=1,
                volume=18.0,
                price=500.0,
                amount=9000.0,
            )
        )
        await session.commit()
        order_id = order.id
        driver_id = driver.id

    async with session_factory() as session:
        await process_dispatch_for_order(session, order_id)
        await session.commit()
        offer = await session.scalar(
            select(OrderOffer)
            .options(
                selectinload(OrderOffer.driver),
                selectinload(OrderOffer.order),
            )
            .where(OrderOffer.order_id == order_id)
        )
        assert offer is not None
        assert offer.status == OrderOfferStatus.pending.value
        await expire_offer(session, offer)
        await session.commit()

    assert sent_notifications == [(str(order_id), str(driver_id), OrderStatus.searching_driver.value)]


@pytest.mark.asyncio
async def test_dispatch_without_candidates_schedules_logist_no_driver_found_notification(
    session_factory,
    monkeypatch,
):
    sent_notifications: list[tuple[str, str]] = []

    def fake_schedule_logist_no_driver_found(order):
        sent_notifications.append((str(order.id), order.status))

    monkeypatch.setattr(
        "app.services.dispatch_service.schedule_logist_no_driver_found_notification",
        fake_schedule_logist_no_driver_found,
    )

    async def fake_get_matching_drivers(*args, **kwargs):
        return []

    monkeypatch.setattr(
        "app.services.dispatch_service.get_matching_drivers",
        fake_get_matching_drivers,
    )

    async with session_factory() as session:
        from app.models.models import Category

        category = Category(name="No Driver", slug="no-driver-push-test", sort_order=0, is_active=True)
        delivery_option = DeliveryOption(
            capacity_m3=20.0,
            title="Truck 20m3 no driver",
            description="",
            base_price=7000.0,
            is_active=True,
            sort_order=0,
        )
        session.add_all([category, delivery_option])
        await session.flush()
        material = Material(
            category_id=category.id,
            name="No driver sand",
            description="",
            price=500.0,
            unit="m3",
            min_volume=1.0,
            is_active=True,
            sort_order=0,
        )
        client_row = Client(name="No Driver Client", phone="+79990039994")
        session.add_all([material, client_row])
        await session.flush()
        order = Order(
            client_id=client_row.id,
            delivery_option_id=delivery_option.id,
            address="No driver address",
            delivery_address="No driver address",
            total_amount=10000.0,
            status=OrderStatus.searching_driver.value,
            source="dispatcher",
            created_by_source="dispatcher",
            dispatch_started_at=datetime.now(UTC),
        )
        session.add(order)
        await session.flush()
        session.add(
            OrderItem(
                order_id=order.id,
                material_id=material.id,
                quantity=1,
                volume=20.0,
                price=500.0,
                amount=10000.0,
            )
        )
        await session.commit()
        order_id = order.id

    async with session_factory() as session:
        await process_dispatch_for_order(session, order_id)
        await session.commit()

    assert sent_notifications == [(str(order_id), OrderStatus.no_driver_found.value)]


@pytest.mark.asyncio
async def test_no_driver_found_order_is_not_reprocessed_by_dispatch_worker(
    session_factory,
    monkeypatch,
):
    sent_notifications: list[tuple[str, str]] = []

    def fake_schedule_logist_no_driver_found(order):
        sent_notifications.append((str(order.id), order.status))

    monkeypatch.setattr(
        "app.services.dispatch_service.schedule_logist_no_driver_found_notification",
        fake_schedule_logist_no_driver_found,
    )

    async def fake_get_matching_drivers(*args, **kwargs):
        return []

    monkeypatch.setattr(
        "app.services.dispatch_service.get_matching_drivers",
        fake_get_matching_drivers,
    )

    async with session_factory() as session:
        from app.models.models import Category

        category = Category(name="No Driver Worker", slug="no-driver-worker-push-test", sort_order=0, is_active=True)
        delivery_option = DeliveryOption(
            capacity_m3=20.0,
            title="Truck 20m3 no driver worker",
            description="",
            base_price=7000.0,
            is_active=True,
            sort_order=0,
        )
        session.add_all([category, delivery_option])
        await session.flush()
        material = Material(
            category_id=category.id,
            name="No driver worker sand",
            description="",
            price=500.0,
            unit="m3",
            min_volume=1.0,
            is_active=True,
            sort_order=0,
        )
        client_row = Client(name="No Driver Worker Client", phone="+79990039993")
        session.add_all([material, client_row])
        await session.flush()
        order = Order(
            client_id=client_row.id,
            delivery_option_id=delivery_option.id,
            address="No driver worker address",
            delivery_address="No driver worker address",
            total_amount=10000.0,
            status=OrderStatus.searching_driver.value,
            source="dispatcher",
            created_by_source="dispatcher",
            dispatch_started_at=datetime.now(UTC),
        )
        session.add(order)
        await session.flush()
        session.add(
            OrderItem(
                order_id=order.id,
                material_id=material.id,
                quantity=1,
                volume=20.0,
                price=500.0,
                amount=10000.0,
            )
        )
        await session.commit()
        order_id = order.id

    async with session_factory() as session:
        await process_dispatch_for_order(session, order_id)
        await session.commit()

    async with session_factory() as session:
        queued_ids = await get_orders_needing_dispatch(session)
        assert order_id not in queued_ids

    async with session_factory() as session:
        await process_dispatch_for_order(session, order_id)
        await session.commit()

    assert sent_notifications == [(str(order_id), OrderStatus.no_driver_found.value)]
