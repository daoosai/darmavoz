import uuid

import pytest
from sqlalchemy import select

from app.models.models import (
    Category,
    Client,
    DeliveryOption,
    Driver,
    DriverStatus,
    Material,
    ModerationStatus,
    Order,
    OrderItem,
    OrderStatus,
    Role,
    User,
    Vehicle,
)
from app.security.auth import get_password_hash
from app.security.jwt import create_access_token
from app.services.dispatch_service import get_matching_drivers


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


async def create_order_with_volume(
    session,
    *,
    volume: float,
    delivery_option: DeliveryOption,
    material: Material,
    status: str = OrderStatus.searching_driver.value,
) -> Order:
    client = Client(name="Тестовый клиент", phone=f"+7999{uuid.uuid4().int % 10_000_000:07d}")
    session.add(client)
    await session.flush()

    order = Order(
        client_id=client.id,
        delivery_option_id=delivery_option.id,
        address="Томск, тестовый адрес",
        total_amount=1000.0,
        status=status,
        source="dispatcher",
        created_by_source="dispatcher",
    )
    session.add(order)
    await session.flush()

    order_item = OrderItem(
        order_id=order.id,
        material_id=material.id,
        quantity=1,
        volume=volume,
        price=1000.0,
        amount=1000.0,
    )
    session.add(order_item)
    order.__dict__["items"] = [order_item]
    order.__dict__["delivery_option"] = delivery_option
    await session.flush()
    return order


@pytest.mark.asyncio
async def test_auto_dispatch_matches_driver_by_vehicle_cubature_range(session_factory):
    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")

        category = Category(name="Щебень", slug="dispatch-range-stone", sort_order=0, is_active=True)
        material = Material(
            category=category,
            name="Щебень фракция",
            description="",
            price=1800.0,
            unit="m3",
            min_volume=5.0,
            is_active=True,
            sort_order=0,
        )
        order_option = DeliveryOption(
            capacity_m3=30.0,
            title="30 м3",
            description="",
            base_price=0.0,
            is_active=True,
            sort_order=0,
        )
        vehicle_option = DeliveryOption(
            capacity_m3=40.0,
            title="40 м3",
            description="",
            base_price=0.0,
            is_active=True,
            sort_order=1,
        )
        session.add_all([category, material, order_option, vehicle_option])
        await session.flush()

        matching_user = await create_user(session, username="range_driver_ok", role=driver_role)
        matching_vehicle = Vehicle(
            title="Самосвал 30-40",
            delivery_option_id=vehicle_option.id,
            is_active=True,
            cubature_min=30.0,
            cubature_max=40.0,
            moderation_status=ModerationStatus.approved.value,
        )
        session.add(matching_vehicle)
        await session.flush()
        matching_driver = Driver(
            user_id=matching_user.id,
            vehicle_id=matching_vehicle.id,
            name="Подходящий водитель",
            phone="+79990010001",
            status=DriverStatus.available.value,
            is_active=True,
            is_auto_dispatch_enabled=True,
            dispatch_priority=100,
            moderation_status=ModerationStatus.approved.value,
        )
        session.add(matching_driver)

        rejected_user = await create_user(session, username="range_driver_bad", role=driver_role)
        rejected_vehicle = Vehicle(
            title="Самосвал 20-25",
            delivery_option_id=order_option.id,
            is_active=True,
            cubature_min=20.0,
            cubature_max=25.0,
            moderation_status=ModerationStatus.approved.value,
        )
        session.add(rejected_vehicle)
        await session.flush()
        rejected_driver = Driver(
            user_id=rejected_user.id,
            vehicle_id=rejected_vehicle.id,
            name="Неподходящий водитель",
            phone="+79990010002",
            status=DriverStatus.available.value,
            is_active=True,
            is_auto_dispatch_enabled=True,
            dispatch_priority=200,
            moderation_status=ModerationStatus.approved.value,
        )
        session.add(rejected_driver)

        pending_user = await create_user(session, username="range_driver_pending", role=driver_role)
        pending_vehicle = Vehicle(
            title="Самосвал 30-40 pending",
            delivery_option_id=vehicle_option.id,
            is_active=True,
            cubature_min=30.0,
            cubature_max=40.0,
            moderation_status=ModerationStatus.pending_moderation.value,
        )
        session.add(pending_vehicle)
        await session.flush()
        pending_driver = Driver(
            user_id=pending_user.id,
            vehicle_id=pending_vehicle.id,
            name="Водитель без модерации",
            phone="+79990010003",
            status=DriverStatus.available.value,
            is_active=True,
            is_auto_dispatch_enabled=True,
            dispatch_priority=300,
            moderation_status=ModerationStatus.approved.value,
        )
        session.add(pending_driver)

        order = await create_order_with_volume(
            session,
            volume=30.0,
            delivery_option=order_option,
            material=material,
        )
        await session.commit()

        drivers = await get_matching_drivers(session, order)
        assert [driver.id for driver in drivers] == [matching_driver.id]


@pytest.mark.asyncio
async def test_logist_drivers_endpoint_filters_by_order_volume_and_approved_status(client, session_factory):
    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        logist_role = await ensure_role(session, "logist")
        await create_user(session, username="range_logist", role=logist_role)

        category = Category(name="Песок", slug="drivers-range-sand", sort_order=0, is_active=True)
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
        order_option = DeliveryOption(capacity_m3=30.0, title="30 м3", description="", base_price=0.0, is_active=True, sort_order=0)
        vehicle_option = DeliveryOption(capacity_m3=40.0, title="40 м3", description="", base_price=0.0, is_active=True, sort_order=1)
        session.add_all([category, material, order_option, vehicle_option])
        await session.flush()

        for username, phone, min_v, max_v, driver_mod, vehicle_mod in [
            ("range_list_ok", "+79990020001", 30.0, 40.0, ModerationStatus.approved.value, ModerationStatus.approved.value),
            ("range_list_small", "+79990020002", 20.0, 25.0, ModerationStatus.approved.value, ModerationStatus.approved.value),
            ("range_list_pending", "+79990020003", 30.0, 40.0, ModerationStatus.pending_moderation.value, ModerationStatus.approved.value),
        ]:
            user = await create_user(session, username=username, role=driver_role)
            vehicle = Vehicle(
                title=username,
                delivery_option_id=vehicle_option.id,
                is_active=True,
                cubature_min=min_v,
                cubature_max=max_v,
                moderation_status=vehicle_mod,
            )
            session.add(vehicle)
            await session.flush()
            driver = Driver(
                user_id=user.id,
                vehicle_id=vehicle.id,
                name=username,
                phone=phone,
                status=DriverStatus.available.value,
                is_active=True,
                is_auto_dispatch_enabled=True,
                dispatch_priority=100,
                moderation_status=driver_mod,
            )
            session.add(driver)

        order = await create_order_with_volume(
            session,
            volume=30.0,
            delivery_option=order_option,
            material=material,
            status=OrderStatus.created.value,
        )
        await session.commit()

    response = await client.get(
        f"/api/v1/drivers/?order_id={order.id}",
        headers=auth_headers("range_logist"),
    )

    assert response.status_code == 200
    payload = response.json()
    names = {item["name"] for item in payload}
    assert "range_list_ok" in names
    assert "range_list_small" not in names
    assert "range_list_pending" not in names
    matching_item = next(item for item in payload if item["name"] == "range_list_ok")
    assert matching_item["vehicle_cubature_min"] == 30.0
    assert matching_item["vehicle_cubature_max"] == 40.0


@pytest.mark.asyncio
async def test_logist_can_assign_driver_manually_by_volume_range_even_with_different_delivery_option(
    client,
    session_factory,
):
    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        logist_role = await ensure_role(session, "logist")
        driver_user = await create_user(session, username="manual_range_driver", role=driver_role)
        await create_user(session, username="manual_range_logist", role=logist_role)

        category = Category(name="Грунт", slug="manual-range-soil", sort_order=0, is_active=True)
        material = Material(
            category=category,
            name="Грунт",
            description="",
            price=1700.0,
            unit="m3",
            min_volume=5.0,
            is_active=True,
            sort_order=0,
        )
        order_option = DeliveryOption(capacity_m3=30.0, title="30 м3", description="", base_price=0.0, is_active=True, sort_order=0)
        vehicle_option = DeliveryOption(capacity_m3=40.0, title="40 м3", description="", base_price=0.0, is_active=True, sort_order=1)
        session.add_all([category, material, order_option, vehicle_option])
        await session.flush()

        vehicle = Vehicle(
            title="Ручной самосвал 30-40",
            delivery_option_id=vehicle_option.id,
            is_active=True,
            cubature_min=30.0,
            cubature_max=40.0,
            moderation_status=ModerationStatus.approved.value,
        )
        session.add(vehicle)
        await session.flush()
        driver = Driver(
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            name="Ручной диапазон",
            phone="+79990030001",
            status=DriverStatus.available.value,
            is_active=True,
            is_auto_dispatch_enabled=True,
            dispatch_priority=100,
            moderation_status=ModerationStatus.approved.value,
        )
        session.add(driver)
        await session.commit()
        await session.refresh(material)
        await session.refresh(order_option)
        await session.refresh(driver)

    create_response = await client.post(
        "/api/v1/logist/orders",
        json={
            "client_name": "Ручной клиент",
            "client_phone": "+79990030002",
            "material_id": str(material.id),
            "delivery_option_id": str(order_option.id),
            "address": "Томск, ручное назначение",
            "notes": "Проверка диапазона",
            "quantity": 1,
            "auto_dispatch": False,
        },
        headers=auth_headers("manual_range_logist"),
    )
    assert create_response.status_code == 201
    order_id = create_response.json()["id"]

    assign_response = await client.post(
        f"/api/v1/orders/{order_id}/assign",
        json={"driver_id": str(driver.id)},
        headers=auth_headers("manual_range_logist"),
    )
    assert assign_response.status_code == 200
    assert assign_response.json()["status"] == OrderStatus.driver_assigned.value
    assert assign_response.json()["driver"]["id"] == str(driver.id)
