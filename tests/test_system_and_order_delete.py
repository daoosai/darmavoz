from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.core.config import settings
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
    OrderStatus,
    Quarry,
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
        "android_version": settings.ANDROID_VERSION,
        "ios_version": settings.IOS_VERSION,
        "web_version": settings.WEB_VERSION,
        "download_url": settings.APK_DOWNLOAD_URL,
        "force_update": settings.APK_FORCE_UPDATE,
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

    assert deleted_order is not None
    assert deleted_order.is_deleted is True
    assert deleted_order.status == OrderStatus.cancelled.value
    assert deleted_order.current_offer_id is None
    assert len(list(remaining_items)) == 1
    remaining_offers_list = list(remaining_offers)
    assert len(remaining_offers_list) == 1
    assert remaining_offers_list[0].status == OrderOfferStatus.cancelled.value
    assert len(list(remaining_events)) == 1


@pytest.mark.asyncio
async def test_logist_order_list_supports_is_deleted_filter(client, session_factory):
    async with session_factory() as session:
        logist_role = await ensure_role(session, "logist")
        await create_user(session, username="archive_filter_logist", role=logist_role)

        client_record = Client(name="Archive Client", phone="+79995550001")
        delivery_option = DeliveryOption(
            capacity_m3=10.0,
            title="Archive 10 m3",
            description="",
            base_price=0.0,
            is_active=True,
            sort_order=0,
        )
        session.add_all([client_record, delivery_option])
        await session.flush()

        active_order = Order(
            client_id=client_record.id,
            delivery_option_id=delivery_option.id,
            address="Active address",
            delivery_address="Active address",
            total_amount=10000.0,
            status=OrderStatus.created.value,
            source="dispatcher",
            created_by_source="dispatcher",
            is_deleted=False,
        )
        archived_order = Order(
            client_id=client_record.id,
            delivery_option_id=delivery_option.id,
            address="Archived address",
            delivery_address="Archived address",
            total_amount=11000.0,
            status=OrderStatus.cancelled.value,
            source="dispatcher",
            created_by_source="dispatcher",
            is_deleted=True,
        )
        session.add_all([active_order, archived_order])
        await session.commit()
        active_order_id = active_order.id
        archived_order_id = archived_order.id

    active_response = await client.get(
        "/api/v1/logist/orders",
        headers=auth_headers("archive_filter_logist"),
    )
    assert active_response.status_code == 200
    active_ids = {item["id"] for item in active_response.json()}
    assert str(active_order_id) in active_ids
    assert str(archived_order_id) not in active_ids

    archive_response = await client.get(
        "/api/v1/logist/orders?is_deleted=true",
        headers=auth_headers("archive_filter_logist"),
    )
    assert archive_response.status_code == 200
    archive_ids = {item["id"] for item in archive_response.json()}
    assert str(active_order_id) not in archive_ids
    assert str(archived_order_id) in archive_ids


@pytest.mark.asyncio
async def test_logist_can_patch_created_order_with_protected_fields(client, session_factory):
    async with session_factory() as session:
        logist_role = await ensure_role(session, "logist")
        await create_user(session, username="order_edit_logist", role=logist_role)

        category = Category(name="Edit Category", slug="edit-order-category", sort_order=0, is_active=True)
        material_old = Material(
            category=category,
            name="Old Material",
            description="",
            price=2000.0,
            unit="m3",
            min_volume=1.0,
            is_active=True,
            sort_order=0,
        )
        material_new = Material(
            category=category,
            name="New Material",
            description="",
            price=3000.0,
            unit="m3",
            min_volume=1.0,
            is_active=True,
            sort_order=1,
        )
        option_old = DeliveryOption(
            capacity_m3=10.0,
            title="Old Truck",
            description="",
            base_price=0.0,
            is_active=True,
            sort_order=0,
        )
        option_new = DeliveryOption(
            capacity_m3=20.0,
            title="New Truck",
            description="",
            base_price=0.0,
            is_active=True,
            sort_order=1,
        )
        quarry = Quarry(name="Edit Quarry", address="Pickup point", lat=55.0, lon=82.0, is_active=True)
        client_record = Client(name="Old Client", phone="+79995550002")
        session.add_all([category, material_old, material_new, option_old, option_new, quarry, client_record])
        await session.flush()

        order = Order(
            client_id=client_record.id,
            delivery_option_id=option_old.id,
            address="Old address",
            delivery_address="Old address",
            total_amount=20000.0,
            delivery_cost=5000.0,
            status=OrderStatus.created.value,
            source="dispatcher",
            created_by_source="dispatcher",
            notes="old note",
        )
        session.add(order)
        await session.flush()
        session.add(
            OrderItem(
                order_id=order.id,
                material_id=material_old.id,
                quantity=1,
                volume=10.0,
                price=2000.0,
                amount=20000.0,
            )
        )
        await session.commit()
        order_id = order.id
        material_new_id = material_new.id
        option_new_id = option_new.id
        quarry_id = quarry.id

    response = await client.patch(
        f"/api/v1/logist/orders/{order_id}",
        headers=auth_headers("order_edit_logist"),
        json={
            "client_name": "New Client",
            "client_phone": "+79995550003",
            "notes": "new note",
            "delivery_address": "New address",
            "delivery_lat": 56.0,
            "delivery_lon": 83.0,
            "material_id": str(material_new_id),
            "vehicle_type_id": str(option_new_id),
            "quarry_id": str(quarry_id),
            "total_amount": 60000.0,
            "delivery_cost": 10000.0,
        },
    )

    assert response.status_code == 200
    assert response.json()["delivery_address"] == "New address"
    assert response.json()["delivery_option_id"] == str(option_new_id)
    assert response.json()["estimated_total_amount"] == 70000.0

    async with session_factory() as session:
        updated_order = await session.scalar(select(Order).where(Order.id == order_id))
        updated_item = await session.scalar(select(OrderItem).where(OrderItem.order_id == order_id))
        updated_client = await session.get(Client, updated_order.client_id)

    assert updated_order is not None
    assert updated_order.address == "New address"
    assert updated_order.delivery_address == "New address"
    assert updated_order.delivery_option_id == option_new_id
    assert updated_order.quarry_id == quarry_id
    assert updated_order.delivery_cost == 10000.0
    assert updated_item is not None
    assert updated_item.material_id == material_new_id
    assert updated_item.volume == 20.0
    assert updated_item.amount == 60000.0
    assert updated_client is not None
    assert updated_client.name == "New Client"
    assert updated_client.phone == "+79995550003"


@pytest.mark.asyncio
async def test_logist_cannot_patch_protected_fields_after_driver_assigned(client, session_factory):
    async with session_factory() as session:
        logist_role = await ensure_role(session, "logist")
        await create_user(session, username="order_edit_restricted_logist", role=logist_role)

        category = Category(name="Restricted Category", slug="restricted-order-category", sort_order=0, is_active=True)
        material = Material(
            category=category,
            name="Restricted Material",
            description="",
            price=1500.0,
            unit="m3",
            min_volume=1.0,
            is_active=True,
            sort_order=0,
        )
        option = DeliveryOption(
            capacity_m3=10.0,
            title="Restricted Truck",
            description="",
            base_price=0.0,
            is_active=True,
            sort_order=0,
        )
        client_record = Client(name="Restricted Client", phone="+79995550004")
        session.add_all([category, material, option, client_record])
        await session.flush()

        order = Order(
            client_id=client_record.id,
            delivery_option_id=option.id,
            address="Restricted address",
            delivery_address="Restricted address",
            total_amount=15000.0,
            delivery_cost=2000.0,
            status=OrderStatus.driver_assigned.value,
            source="dispatcher",
            created_by_source="dispatcher",
            notes="old restricted note",
        )
        session.add(order)
        await session.flush()
        session.add(
            OrderItem(
                order_id=order.id,
                material_id=material.id,
                quantity=1,
                volume=10.0,
                price=1500.0,
                amount=15000.0,
            )
        )
        await session.commit()
        order_id = order.id

    forbidden_response = await client.patch(
        f"/api/v1/logist/orders/{order_id}",
        headers=auth_headers("order_edit_restricted_logist"),
        json={"delivery_address": "Forbidden address"},
    )
    assert forbidden_response.status_code == 400

    allowed_response = await client.patch(
        f"/api/v1/logist/orders/{order_id}",
        headers=auth_headers("order_edit_restricted_logist"),
        json={
            "client_name": "Allowed Client",
            "client_phone": "+79995550005",
            "notes": "allowed note",
        },
    )
    assert allowed_response.status_code == 200

    async with session_factory() as session:
        updated_order = await session.scalar(select(Order).where(Order.id == order_id))
        updated_client = await session.get(Client, updated_order.client_id)

    assert updated_order is not None
    assert updated_order.delivery_address == "Restricted address"
    assert updated_order.notes == "allowed note"
    assert updated_client is not None
    assert updated_client.name == "Allowed Client"
    assert updated_client.phone == "+79995550005"
