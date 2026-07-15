from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.models.models import CartItem, Category, Client, DeliveryOption, Driver, Material, MediaFile, Order, OrderOffer, Role, User, Vehicle
from app.security.auth import get_password_hash, verify_password
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


async def create_delivery_option(session, *, capacity_m3: float, title: str) -> DeliveryOption:
    delivery_option = DeliveryOption(
        capacity_m3=capacity_m3,
        title=title,
        description="",
        base_price=5000.0,
        is_active=True,
        sort_order=0,
    )
    session.add(delivery_option)
    await session.flush()
    return delivery_option


@pytest.mark.asyncio
async def test_admin_category_crud_and_safe_delete(client, session_factory, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    unique = uuid4().hex[:8]

    created = await client.post(
        "/api/v1/admin/categories/",
        headers=headers,
        json={"name": f"Новая категория {unique}", "is_active": True},
    )
    assert created.status_code == 201
    category_id = created.json()["id"]
    assert created.json()["slug"]

    updated = await client.patch(
        f"/api/v1/admin/categories/{category_id}",
        headers=headers,
        json={"name": f"Обновленная категория {unique}", "is_active": False},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == f"Обновленная категория {unique}"
    assert updated.json()["is_active"] is False

    categories = await client.get("/api/v1/admin/categories/", headers=headers)
    assert categories.status_code == 200
    assert any(item["id"] == category_id for item in categories.json())

    async with session_factory() as session:
        session.add(
            Material(
                category_id=UUID(category_id),
                name=f"Материал {unique}",
                price=1000,
                unit="m3",
                min_volume=1,
                is_active=True,
            )
        )
        await session.commit()

    hidden = await client.delete(
        f"/api/v1/admin/categories/{category_id}",
        headers=headers,
    )
    assert hidden.status_code == 200
    assert hidden.json()["action"] == "hidden"

    empty = await client.post(
        "/api/v1/admin/categories/",
        headers=headers,
        json={"name": f"Пустая категория {unique}", "is_active": True},
    )
    deleted = await client.delete(
        f"/api/v1/admin/categories/{empty.json()['id']}",
        headers=headers,
    )
    assert deleted.status_code == 200
    assert deleted.json()["action"] == "deleted"


@pytest.mark.asyncio
async def test_material_delete_hides_when_linked_to_cart_items(client, session_factory):
    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        await create_user(session, username="catalog_admin", role=admin_role)

        category = Category(name="Песок", slug=f"sand-{uuid4().hex[:8]}", sort_order=0, is_active=True)
        material = Material(
            category=category,
            name="Карьерный песок",
            description="",
            price=1000.0,
            unit="m3",
            min_volume=1.0,
            is_active=True,
            sort_order=0,
        )
        session.add_all([category, material])
        await session.flush()

        session.add(
            CartItem(
                session_key="test-admin-delete",
                material_id=material.id,
                volume=3.0,
                unit_price=1000.0,
                amount=3000.0,
            )
        )
        await session.commit()
        material_id = material.id

    response = await client.delete(
        f"/api/v1/admin/materials/{material_id}",
        headers=auth_headers("catalog_admin"),
    )

    assert response.status_code == 200
    assert response.json()["action"] == "hidden"

    async with session_factory() as session:
        stored_material = await session.get(Material, material_id)

    assert stored_material is not None
    assert stored_material.is_active is False


@pytest.mark.asyncio
async def test_material_delete_requires_admin_role(client, session_factory):
    async with session_factory() as session:
        logist_role = await ensure_role(session, "logist")
        await create_user(session, username="catalog_logist", role=logist_role)

        category = Category(name="Щебень", slug=f"stone-{uuid4().hex[:8]}", sort_order=0, is_active=True)
        material = Material(
            category=category,
            name="Щебень 5-20",
            description="",
            price=2200.0,
            unit="m3",
            min_volume=1.0,
            is_active=True,
            sort_order=0,
        )
        session.add_all([category, material])
        await session.commit()
        material_id = material.id

    response = await client.delete(
        f"/api/v1/admin/materials/{material_id}",
        headers=auth_headers("catalog_logist"),
    )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_delivery_option_delete_hides_when_linked_to_vehicle(client, session_factory):
    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        await create_user(session, username="delivery_admin", role=admin_role)

        delivery_option = DeliveryOption(
            capacity_m3=12.0,
            title="Самосвал 12 м3",
            description="",
            base_price=5000.0,
            is_active=True,
            sort_order=0,
        )
        session.add(delivery_option)
        await session.flush()

        session.add(
            Vehicle(
                title="Vehicle-bound option",
                delivery_option_id=delivery_option.id,
                is_active=True,
            )
        )
        await session.commit()
        delivery_option_id = delivery_option.id

    response = await client.delete(
        f"/api/v1/admin/delivery-options/{delivery_option_id}",
        headers=auth_headers("delivery_admin"),
    )

    assert response.status_code == 200
    assert response.json()["action"] == "hidden"

    async with session_factory() as session:
        stored_option = await session.get(DeliveryOption, delivery_option_id)

    assert stored_option is not None
    assert stored_option.is_active is False


@pytest.mark.asyncio
async def test_public_delivery_option_detail_returns_primary_image_and_media(client, session_factory):
    async with session_factory() as session:
        delivery_option = DeliveryOption(
            capacity_m3=15.0,
            title="Самосвал 15 м3",
            description="",
            base_price=6500.0,
            is_active=True,
            sort_order=0,
        )
        session.add(delivery_option)
        await session.flush()

        session.add_all(
            [
                MediaFile(
                    entity_type="delivery_option",
                    entity_id=delivery_option.id,
                    bucket="darmavoz-media",
                    object_key=f"delivery-option/{uuid4()}.jpg",
                    public_url="https://darmavoz.ru/s3/darmavoz-media/delivery-option/primary.jpg",
                    content_type="image/jpeg",
                    file_name="primary.jpg",
                    file_size=1024,
                    is_primary=True,
                    slot_key="main",
                ),
                MediaFile(
                    entity_type="delivery_option",
                    entity_id=delivery_option.id,
                    bucket="darmavoz-media",
                    object_key=f"delivery-option/{uuid4()}.jpg",
                    public_url="https://darmavoz.ru/s3/darmavoz-media/delivery-option/secondary.jpg",
                    content_type="image/jpeg",
                    file_name="secondary.jpg",
                    file_size=2048,
                    is_primary=False,
                    slot_key="gallery",
                ),
            ]
        )
        await session.commit()
        delivery_option_id = delivery_option.id

    response = await client.get(f"/api/v1/catalog/delivery-options/{delivery_option_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(delivery_option_id)
    assert body["primary_image_url"] == "https://darmavoz.ru/s3/darmavoz-media/delivery-option/primary.jpg"
    assert [item["public_url"] for item in body["media_files"]] == [
        "https://darmavoz.ru/s3/darmavoz-media/delivery-option/primary.jpg",
        "https://darmavoz.ru/s3/darmavoz-media/delivery-option/secondary.jpg",
    ]


@pytest.mark.asyncio
async def test_admin_can_create_driver_with_vehicle_and_password(client, session_factory):
    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        await create_user(session, username="drivers_admin", role=admin_role)
        await session.commit()

    response = await client.post(
        "/api/v1/admin/drivers",
        headers=auth_headers("drivers_admin"),
        json={
            "name": "Новый водитель",
            "phone": "+79990000123",
            "password": "secret123",
            "vehicle_brand": "КамАЗ",
            "vehicle_plate_number": "А123АА 116",
            "vehicle_type": "самосвал",
            "cubature_min": 10.0,
            "cubature_max": 12.0,
            "tonnage_min": 5.0,
            "tonnage_max": 7.5,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Новый водитель"
    assert body["phone"] == "+79990000123"
    assert body["status"] == "available"
    assert body["vehicle"]["id"]
    assert body["vehicle"]["delivery_option_id"] is None
    assert body["vehicle"]["brand"] == "КамАЗ"
    assert body["vehicle"]["plate_number"] == "А123АА 116"
    assert body["vehicle"]["vehicle_type"] == "самосвал"
    assert body["vehicle"]["moderation_status"] == "approved"

    async with session_factory() as session:
        driver = await session.scalar(select(Driver).where(Driver.phone == "+79990000123"))
        user = await session.scalar(select(User).where(User.username == "+79990000123"))
        vehicle = await session.get(Vehicle, driver.vehicle_id)

    assert driver is not None
    assert user is not None
    assert verify_password("secret123", user.hashed_password)
    assert vehicle is not None
    assert vehicle.delivery_option_id is None
    assert vehicle.brand == "КамАЗ"
    assert vehicle.plate_number == "А123АА 116"
    assert vehicle.vehicle_type == "самосвал"
    assert vehicle.cubature_min == 10.0
    assert vehicle.cubature_max == 12.0
    assert vehicle.tonnage_min == 5.0
    assert vehicle.tonnage_max == 7.5
    assert vehicle.moderation_status == "approved"
    assert driver.status == "available"


@pytest.mark.asyncio
async def test_admin_can_recreate_driver_with_same_phone_after_delete(client, session_factory):
    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        driver_role = await ensure_role(session, "driver")
        await create_user(session, username="drivers_recreate_admin", role=admin_role)
        driver_user = await create_user(session, username="+79990000125", role=driver_role)
        vehicle = Vehicle(title="Truck recreate", is_active=True)
        session.add(vehicle)
        await session.flush()
        driver = Driver(
            name="Удаляемый водитель",
            phone="+79990000125",
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            status="available",
            is_active=True,
        )
        session.add(driver)
        await session.commit()
        driver_id = driver.id

    delete_response = await client.delete(
        f"/api/v1/admin/drivers/{driver_id}",
        headers=auth_headers("drivers_recreate_admin"),
    )

    assert delete_response.status_code == 200

    create_response = await client.post(
        "/api/v1/admin/drivers",
        headers=auth_headers("drivers_recreate_admin"),
        json={
            "name": "Новый водитель",
            "phone": "+79990000125",
            "password": "secret123",
            "vehicle_brand": "Shacman",
            "vehicle_plate_number": "А125АА 116",
            "vehicle_type": "самосвал",
            "cubature_min": 10.0,
            "cubature_max": 12.0,
            "tonnage_min": 5.0,
            "tonnage_max": 7.5
        },
    )

    assert create_response.status_code == 201
    assert create_response.json()["phone"] == "+79990000125"


@pytest.mark.asyncio
async def test_admin_can_create_inactive_driver_as_offline(client, session_factory):
    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        await create_user(session, username="drivers_admin_inactive", role=admin_role)
        await session.commit()

    response = await client.post(
        "/api/v1/admin/drivers",
        headers=auth_headers("drivers_admin_inactive"),
        json={
            "name": "Неактивный водитель",
            "phone": "+79990000124",
            "password": "secret123",
            "vehicle_brand": "КамАЗ",
            "vehicle_plate_number": "А124АА 116",
            "vehicle_type": "самосвал",
            "cubature_min": 10.0,
            "cubature_max": 12.0,
            "tonnage_min": 5.0,
            "tonnage_max": 7.5,
            "is_active": False
        },
    )

    assert response.status_code == 201
    assert response.json()["status"] == "offline"


@pytest.mark.asyncio
async def test_admin_can_update_driver_password_and_rebind_vehicle(client, session_factory):
    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        driver_role = await ensure_role(session, "driver")
        await create_user(session, username="drivers_editor", role=admin_role)
        driver_user = await create_user(session, username="+79990000456", role=driver_role)
        option_10 = await create_delivery_option(session, capacity_m3=10.0, title="Самосвал 10 м3")
        option_20 = await create_delivery_option(session, capacity_m3=20.0, title="Самосвал 20 м3")
        vehicle_10 = Vehicle(title="Truck 10", delivery_option_id=option_10.id, is_active=True)
        vehicle_20 = Vehicle(title="Truck 20", delivery_option_id=option_20.id, is_active=True)
        session.add_all([vehicle_10, vehicle_20])
        await session.flush()
        driver = Driver(
            name="Редактируемый водитель",
            phone="+79990000456",
            user_id=driver_user.id,
            vehicle_id=vehicle_10.id,
            status="offline",
            is_auto_dispatch_enabled=True,
            dispatch_priority=100,
        )
        session.add(driver)
        await session.commit()
        driver_id = driver.id
        vehicle_20_id = vehicle_20.id

    response = await client.patch(
        f"/api/v1/admin/drivers/{driver_id}",
        headers=auth_headers("drivers_editor"),
        json={
            "password": "updated123",
            "vehicle_id": str(vehicle_20_id),
            "status": "available",
            "dispatch_priority": 50,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "available"
    assert body["dispatch_priority"] == 50
    assert body["vehicle"]["id"] == str(vehicle_20_id)

    async with session_factory() as session:
        driver = await session.get(Driver, driver_id)
        user = await session.scalar(select(User).where(User.id == driver.user_id))

    assert driver is not None
    assert driver.vehicle_id == vehicle_20_id
    assert verify_password("updated123", user.hashed_password)


@pytest.mark.asyncio
async def test_admin_delete_driver_hard_deletes_driver_and_user(client, session_factory):
    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        driver_role = await ensure_role(session, "driver")
        await create_user(session, username="drivers_firer", role=admin_role)
        driver_user = await create_user(session, username="+79990000789", role=driver_role)
        delivery_option = await create_delivery_option(session, capacity_m3=15.0, title="Самосвал 15 м3")
        vehicle = Vehicle(title="Truck 15", delivery_option_id=delivery_option.id, is_active=True)
        session.add(vehicle)
        await session.flush()
        driver = Driver(
            name="Увольняемый водитель",
            phone="+79990000789",
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            status="available",
            is_auto_dispatch_enabled=True,
            dispatch_priority=100,
        )
        session.add(driver)
        await session.flush()
        client = Client(name="Delete Driver Client", phone="+79990000788")
        session.add(client)
        await session.flush()
        order = Order(
            client_id=client.id,
            driver_id=driver.id,
            delivery_option_id=delivery_option.id,
            address="Test address",
            total_amount=1000.0,
            status="driver_assigned",
        )
        session.add(order)
        await session.flush()
        offer = OrderOffer(
            order_id=order.id,
            driver_id=driver.id,
            price=1000.0,
            sequence_no=1,
            status="accepted",
        )
        session.add(offer)
        await session.flush()
        order.current_offer_id = offer.id
        await session.commit()
        driver_id = driver.id
        driver_user_id = driver_user.id
        order_id = order.id
        offer_id = offer.id

    response = await client.delete(
        f"/api/v1/admin/drivers/{driver_id}",
        headers=auth_headers("drivers_firer"),
    )

    assert response.status_code == 200
    assert response.json()["action"] == "deleted"

    async with session_factory() as session:
        driver = await session.get(Driver, driver_id)
        user = await session.get(User, driver_user_id)
        order = await session.get(Order, order_id)
        offer = await session.get(OrderOffer, offer_id)

    assert driver is None
    assert user is None
    assert order is not None
    assert order.driver_id is None
    assert order.status == "created"
    assert order.assigned_at is None
    assert order.current_offer_id is None
    assert offer is None


@pytest.mark.asyncio
async def test_admin_driver_endpoints_require_admin_role(client, session_factory):
    async with session_factory() as session:
        logist_role = await ensure_role(session, "logist")
        await create_user(session, username="drivers_logist", role=logist_role)
        delivery_option = await create_delivery_option(session, capacity_m3=8.0, title="Самосвал 8 м3")
        await session.commit()
        delivery_option_id = delivery_option.id

    response = await client.post(
        "/api/v1/admin/drivers",
        headers=auth_headers("drivers_logist"),
        json={
            "name": "Forbidden driver",
            "phone": "+79990000999",
            "password": "secret123",
            "delivery_option_id": str(delivery_option_id),
        },
    )

    assert response.status_code == 403
