import pytest
from sqlalchemy import select

from main import app
from app.models.models import DeliveryOption, Driver, MediaFile, ModerationStatus, Role, User, Vehicle
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
async def test_driver_can_self_register_with_incomplete_moderation(client, session_factory):
    response = await client.post(
        "/api/v1/auth/driver/register",
        json={
            "phone": "+79990010101",
            "password": "driver123",
            "name": "Новый водитель",
            "vehicle_brand": "КамАЗ",
            "vehicle_plate_number": "А123АА72",
            "cubature_min": 10.0,
            "cubature_max": 14.0,
            "tonnage_min": 8.0,
            "tonnage_max": 12.0,
            "vehicle_type": "самосвал",
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["role"] == "driver"
    assert payload["driver"]["phone"] == "+79990010101"
    assert payload["driver"]["moderation_status"] == ModerationStatus.incomplete.value
    assert payload["driver"]["vehicle"]["brand"] == "КамАЗ"
    assert payload["driver"]["vehicle"]["plate_number"] == "А123АА72"
    assert payload["driver"]["vehicle"]["cubature_min"] == 10.0
    assert payload["driver"]["vehicle"]["cubature_max"] == 14.0
    assert payload["driver"]["vehicle"]["tonnage_min"] == 8.0
    assert payload["driver"]["vehicle"]["tonnage_max"] == 12.0
    assert payload["driver"]["vehicle"]["vehicle_type"] == "самосвал"
    assert payload["driver"]["vehicle"]["moderation_status"] == ModerationStatus.incomplete.value
    assert payload["driver"]["vehicle"]["delivery_option_id"] is None

    async with session_factory() as session:
        driver = await session.scalar(select(Driver).where(Driver.phone == "+79990010101"))
        user = await session.scalar(select(User).where(User.username == "+79990010101"))
        vehicle = await session.get(Vehicle, driver.vehicle_id)

    assert driver is not None
    assert user is not None
    assert driver.user_id == user.id
    assert vehicle is not None
    assert vehicle.brand == "КамАЗ"
    assert vehicle.plate_number == "А123АА72"
    assert vehicle.cubature_min == 10.0
    assert vehicle.cubature_max == 14.0
    assert vehicle.tonnage_min == 8.0
    assert vehicle.tonnage_max == 12.0
    assert vehicle.vehicle_type == "самосвал"
    assert vehicle.delivery_option_id is None


@pytest.mark.asyncio
@pytest.mark.asyncio
async def test_driver_register_returns_russian_conflict_for_duplicate_phone(client, session_factory):
    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        driver_user = await create_user(session, username="+79990010101", role=driver_role)
        vehicle = Vehicle(title="Duplicate phone vehicle", is_active=True)
        session.add(vehicle)
        await session.flush()
        driver = Driver(
            name="Существующий водитель",
            phone="+79990010101",
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            status="offline",
            moderation_status=ModerationStatus.incomplete.value,
        )
        session.add(driver)
        await session.commit()

    response = await client.post(
        "/api/v1/auth/driver/register",
        json={
            "phone": "+79990010101",
            "password": "driver123",
            "name": "Новый водитель",
            "vehicle_brand": "КамАЗ",
            "vehicle_plate_number": "А123АА72",
            "cubature_min": 10.0,
            "cubature_max": 14.0,
            "tonnage_min": 8.0,
            "tonnage_max": 12.0,
            "vehicle_type": "самосвал",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Водитель с таким номером телефона уже существует"


async def test_driver_register_accepts_title_case_vehicle_type(client):
    response = await client.post(
        "/api/v1/auth/driver/register",
        json={
            "phone": "+79990010111",
            "password": "driver123",
            "name": "Водитель с title case",
            "vehicle_brand": "КамАЗ",
            "vehicle_plate_number": "А111АА72",
            "cubature_min": 10.0,
            "cubature_max": 14.0,
            "tonnage_min": 8.0,
            "tonnage_max": 12.0,
            "vehicle_type": "Самосвал",
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["driver"]["vehicle"]["vehicle_type"] == "самосвал"


@pytest.mark.asyncio
async def test_driver_profile_update_resets_driver_moderation_and_updates_username(client, session_factory):
    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        driver_user = await create_user(session, username="+79990010202", role=driver_role)
        driver = Driver(
            name="Старое имя",
            phone="+79990010202",
            user_id=driver_user.id,
            status="offline",
            moderation_status=ModerationStatus.approved.value,
        )
        session.add(driver)
        await session.commit()

    response = await client.patch(
        "/api/v1/driver/profile",
        headers=auth_headers("+79990010202"),
        json={"name": "Новое имя", "phone": "+79990010203"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "Новое имя"
    assert payload["phone"] == "+79990010203"
    assert payload["moderation_status"] == ModerationStatus.incomplete.value

    async with session_factory() as session:
        driver = await session.scalar(select(Driver).where(Driver.phone == "+79990010203"))
        user = await session.scalar(select(User).where(User.id == driver.user_id))

    assert driver is not None
    assert user is not None
    assert user.username == "+79990010203"


@pytest.mark.asyncio
async def test_driver_vehicle_patch_creates_vehicle_and_keeps_incomplete_without_photos(client, session_factory):
    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        driver_user = await create_user(session, username="+79990010303", role=driver_role)
        delivery_option = await create_delivery_option(session, capacity_m3=15.0, title="Самосвал 15 м3")
        driver = Driver(
            name="Водитель без машины",
            phone="+79990010303",
            user_id=driver_user.id,
            status="offline",
            moderation_status=ModerationStatus.approved.value,
        )
        session.add(driver)
        await session.commit()
        delivery_option_id = delivery_option.id

    response = await client.patch(
        "/api/v1/driver/vehicle",
        headers=auth_headers("+79990010303"),
        json={
            "brand": "КамАЗ",
            "model": "6520",
            "plate_number": "А123АА72",
            "vehicle_type": "Самосвал",
            "body_volume_m3": 15.0,
            "delivery_option_id": str(delivery_option_id),
            "rate_mode": "fixed",
            "fixed_rate": 18000.0,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["vehicle"]["brand"] == "КамАЗ"
    assert payload["vehicle"]["model"] == "6520"
    assert payload["vehicle"]["moderation_status"] == ModerationStatus.incomplete.value
    assert payload["vehicle"]["fixed_rate"] == 18000.0
    assert payload["vehicle"]["rate_per_ton_km"] is None


@pytest.mark.asyncio
async def test_driver_full_profile_returns_vehicle_block(client, session_factory):
    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        driver_user = await create_user(session, username="+79990010404", role=driver_role)
        delivery_option = await create_delivery_option(session, capacity_m3=10.0, title="Самосвал 10 м3")
        vehicle = Vehicle(
            title="Truck profile",
            brand="MAN",
            model="TGS",
            plate_number="В456ВВ72",
            delivery_option_id=delivery_option.id,
            is_active=True,
            moderation_status=ModerationStatus.approved.value,
        )
        session.add(vehicle)
        await session.flush()
        driver = Driver(
            name="Водитель с машиной",
            phone="+79990010404",
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            status="offline",
            moderation_status=ModerationStatus.approved.value,
        )
        session.add(driver)
        await session.commit()

    response = await client.get(
        "/api/v1/driver/profile/full",
        headers=auth_headers("+79990010404"),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["phone"] == "+79990010404"
    assert payload["vehicle"]["brand"] == "MAN"
    assert payload["vehicle"]["media_files"] == []


@pytest.mark.asyncio
async def test_driver_order_endpoints_require_approved_driver(client, session_factory):
    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        driver_user = await create_user(session, username="+79990010505", role=driver_role)
        driver = Driver(
            name="Pending Driver",
            phone="+79990010505",
            user_id=driver_user.id,
            status="offline",
            moderation_status=ModerationStatus.pending_moderation.value,
        )
        session.add(driver)
        await session.commit()

    response = await client.get(
        "/api/v1/driver/orders",
        headers=auth_headers("+79990010505"),
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Driver moderation is not approved"


@pytest.mark.asyncio
async def test_driver_register_normalizes_phone_and_login_accepts_normalized_phone(client):
    response = await client.post(
        "/api/v1/auth/driver/register",
        json={
            "full_name": "Masked Driver",
            "phone": "+7 (999) 000-11-22",
            "password": "driver123",
            "vehicle_brand": "MAN",
            "vehicle_plate_number": "В456ВВ72",
            "cubature_min": 12.0,
            "cubature_max": 16.0,
            "tonnage_min": 10.0,
            "tonnage_max": 18.0,
            "vehicle_type": "бортовой",
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["driver"]["phone"] == "+79990001122"

    login_response = await client.post(
        "/api/v1/auth/login",
        data={"username": "+79990001122", "password": "driver123"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    assert login_response.status_code == 200
    assert login_response.json()["role"] == "driver"


@pytest.mark.asyncio
async def test_driver_register_rejects_invalid_min_max_ranges(client):
    response = await client.post(
        "/api/v1/auth/driver/register",
        json={
            "name": "Bad Range Driver",
            "phone": "+79990001133",
            "password": "driver123",
            "vehicle_brand": "FAW",
            "vehicle_plate_number": "С789СС72",
            "cubature_min": 15.0,
            "cubature_max": 10.0,
            "tonnage_min": 9.0,
            "tonnage_max": 8.0,
            "vehicle_type": "будка",
        },
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_driver_vehicle_submit_requires_new_text_fields(client, session_factory):
    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        driver_user = await create_user(session, username="+79990011414", role=driver_role)
        vehicle = Vehicle(
            title="Old schema vehicle",
            brand="КамАЗ",
            plate_number="А222АА72",
            body_volume_m3=12.0,
            is_active=True,
            moderation_status=ModerationStatus.incomplete.value,
        )
        session.add(vehicle)
        await session.flush()
        driver = Driver(
            name="Submit Text Driver",
            phone="+79990011414",
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            status="offline",
            moderation_status=ModerationStatus.incomplete.value,
        )
        session.add(driver)
        await session.commit()

    response = await client.post(
        "/api/v1/driver/vehicle/submit",
        headers=auth_headers("+79990011414"),
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Не заполнены обязательные текстовые данные автомобиля"


@pytest.mark.asyncio
async def test_driver_vehicle_submit_requires_all_three_required_photos(client, session_factory):
    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        driver_user = await create_user(session, username="+79990011515", role=driver_role)
        vehicle = Vehicle(
            title="Ready except photos",
            brand="КамАЗ",
            plate_number="А333АА72",
            vehicle_type="самосвал",
            cubature_min=10.0,
            cubature_max=12.0,
            tonnage_min=8.0,
            tonnage_max=10.0,
            is_active=True,
            moderation_status=ModerationStatus.incomplete.value,
        )
        session.add(vehicle)
        await session.flush()
        driver = Driver(
            name="Submit Photo Driver",
            phone="+79990011515",
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            status="offline",
            moderation_status=ModerationStatus.incomplete.value,
        )
        session.add(driver)
        await session.flush()
        session.add_all(
            [
                MediaFile(
                    entity_type="vehicle",
                    entity_id=vehicle.id,
                    bucket="demo",
                    object_key="vehicles/main-submit.jpg",
                    public_url="https://example.com/main-submit.jpg",
                    content_type="image/jpeg",
                    file_name="main-submit.jpg",
                    file_size=100,
                    slot_key="vehicle_main",
                ),
                MediaFile(
                    entity_type="vehicle",
                    entity_id=vehicle.id,
                    bucket="demo",
                    object_key="vehicles/left-submit.jpg",
                    public_url="https://example.com/left-submit.jpg",
                    content_type="image/jpeg",
                    file_name="left-submit.jpg",
                    file_size=100,
                    slot_key="vehicle_left",
                ),
            ]
        )
        await session.commit()

    response = await client.post(
        "/api/v1/driver/vehicle/submit",
        headers=auth_headers("+79990011515"),
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Необходимо загрузить все 3 фотографии автомобиля"


@pytest.mark.asyncio
async def test_admin_can_approve_reject_and_suspend_driver_and_vehicle(client, session_factory):
    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        driver_role = await ensure_role(session, "driver")
        admin_user = await create_user(session, username="sprint11_admin", role=admin_role)
        driver_user = await create_user(session, username="+79990010606", role=driver_role)
        delivery_option = await create_delivery_option(session, capacity_m3=20.0, title="Самосвал 20 м3")
        vehicle = Vehicle(
            title="Truck moderation",
            delivery_option_id=delivery_option.id,
            is_active=True,
            moderation_status=ModerationStatus.pending_moderation.value,
        )
        session.add(vehicle)
        await session.flush()
        driver = Driver(
            name="Driver moderation",
            phone="+79990010606",
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            status="offline",
            moderation_status=ModerationStatus.pending_moderation.value,
        )
        session.add(driver)
        await session.commit()
        driver_id = driver.id
        vehicle_id = vehicle.id
        admin_username = admin_user.username

    approve_driver = await client.post(
        f"/api/v1/admin/drivers/{driver_id}/approve",
        headers=auth_headers(admin_username),
        json={"comment": "documents ok"},
    )
    assert approve_driver.status_code == 200
    assert approve_driver.json()["moderation_status"] == ModerationStatus.approved.value
    assert approve_driver.json()["status"] == "available"

    reject_vehicle = await client.post(
        f"/api/v1/admin/vehicles/{vehicle_id}/reject",
        headers=auth_headers(admin_username),
        json={"comment": "bad photo"},
    )
    assert reject_vehicle.status_code == 200
    assert reject_vehicle.json()["moderation_status"] == ModerationStatus.rejected.value

    suspend_driver = await client.post(
        f"/api/v1/admin/drivers/{driver_id}/suspend",
        headers=auth_headers(admin_username),
        json={"comment": "blocked"},
    )
    assert suspend_driver.status_code == 200
    assert suspend_driver.json()["moderation_status"] == ModerationStatus.suspended.value

    approve_vehicle = await client.post(
        f"/api/v1/admin/vehicles/{vehicle_id}/approve",
        headers=auth_headers(admin_username),
        json={"comment": "fixed"},
    )
    assert approve_vehicle.status_code == 200
    assert approve_vehicle.json()["moderation_status"] == ModerationStatus.approved.value

    async with session_factory() as session:
        driver = await session.get(Driver, driver_id)
        vehicle = await session.get(Vehicle, vehicle_id)

    assert driver is not None
    assert vehicle is not None
    assert driver.moderation_status == ModerationStatus.suspended.value
    assert driver.status == "available"
    assert driver.moderated_by_user_id is not None
    assert vehicle.moderation_status == ModerationStatus.approved.value


@pytest.mark.asyncio
async def test_admin_vehicle_list_includes_pending_moderation_and_vehicle_media(client, session_factory):
    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        admin_user = await create_user(session, username="sprint11_vehicle_admin", role=admin_role)
        delivery_option = await create_delivery_option(session, capacity_m3=18.0, title="Самосвал 18 м3")
        vehicle = Vehicle(
            title="Truck with media",
            brand="КамАЗ",
            plate_number="А001АА70",
            delivery_option_id=delivery_option.id,
            is_active=True,
            moderation_status=ModerationStatus.pending_moderation.value,
        )
        session.add(vehicle)
        await session.flush()
        session.add_all(
            [
                MediaFile(
                    entity_type="vehicle",
                    entity_id=vehicle.id,
                    bucket="test-bucket",
                    object_key="vehicles/main.jpg",
                    public_url="https://example.com/main.jpg",
                    content_type="image/jpeg",
                    file_name="main.jpg",
                    file_size=111,
                    slot_key="vehicle_main",
                    is_primary=True,
                ),
                MediaFile(
                    entity_type="vehicle",
                    entity_id=vehicle.id,
                    bucket="test-bucket",
                    object_key="vehicles/left.jpg",
                    public_url="https://example.com/left.jpg",
                    content_type="image/jpeg",
                    file_name="left.jpg",
                    file_size=222,
                    slot_key="vehicle_left",
                    is_primary=False,
                ),
                MediaFile(
                    entity_type="vehicle",
                    entity_id=vehicle.id,
                    bucket="test-bucket",
                    object_key="vehicles/plate.jpg",
                    public_url="https://example.com/plate.jpg",
                    content_type="image/jpeg",
                    file_name="plate.jpg",
                    file_size=333,
                    slot_key="vehicle_plate",
                    is_primary=False,
                ),
            ]
        )
        await session.commit()
        admin_username = admin_user.username

    response = await client.get(
        "/api/v1/admin/vehicles",
        headers=auth_headers(admin_username),
    )

    assert response.status_code == 200
    payload = response.json()
    vehicle_payload = next(item for item in payload if item["title"] == "Truck with media")
    assert vehicle_payload["moderation_status"] == ModerationStatus.pending_moderation.value
    assert {item["slot_key"] for item in vehicle_payload["media_files"]} >= {
        "vehicle_main",
        "vehicle_left",
        "vehicle_plate",
    }
    assert vehicle_payload["media_files"][0]["public_url"].startswith("https://example.com/")


@pytest.mark.asyncio
async def test_admin_moderation_endpoints_allow_empty_body(client, session_factory):
    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        driver_role = await ensure_role(session, "driver")
        admin_user = await create_user(session, username="sprint11_admin_empty_body", role=admin_role)
        driver_user = await create_user(session, username="+79990007788", role=driver_role)
        driver = Driver(
            name="Pending Driver",
            phone="+79990007788",
            user_id=driver_user.id,
            status="offline",
            moderation_status=ModerationStatus.pending_moderation.value,
        )
        session.add(driver)
        await session.commit()
        driver_id = driver.id
        admin_username = admin_user.username

    response = await client.post(
        f"/api/v1/admin/drivers/{driver_id}/approve",
        headers=auth_headers(admin_username),
    )

    assert response.status_code == 200
    assert response.json()["moderation_status"] == ModerationStatus.approved.value


class FakeStorageService:
    bucket = "test-bucket"

    def assert_supported_entity_type(self, entity_type: str) -> None:
        assert entity_type == "vehicle"

    def assert_supported_image(self, file_name: str, content_type: str, file_size: int) -> None:
        assert file_name
        assert content_type.startswith("image/")
        assert file_size > 0

    def build_object_key(self, entity_type: str, file_name: str) -> str:
        return f"uploads/{entity_type}/{file_name}"

    def generate_presigned_put(self, object_key: str, content_type: str) -> str:
        return f"https://upload.example.com/{object_key}?content_type={content_type}"

    def build_public_url(self, object_key: str) -> str:
        return f"https://cdn.example.com/{object_key}"

    def head_object(self, object_key: str) -> dict:
        return {
            "ContentType": "image/jpeg",
            "ContentLength": 2048,
        }


@pytest.mark.asyncio
async def test_admin_media_upload_can_target_vehicle_by_entity_id(client, session_factory, monkeypatch):
    monkeypatch.setattr("app.api.media.get_storage_service", lambda: FakeStorageService())

    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        await create_user(session, username="admin_media_uploader", role=admin_role)
        vehicle = Vehicle(
            title="Admin uploaded vehicle",
            brand="КамАЗ",
            plate_number="А555АА72",
            vehicle_type="самосвал",
            is_active=True,
            moderation_status=ModerationStatus.approved.value,
        )
        session.add(vehicle)
        await session.commit()
        vehicle_id = vehicle.id

    presign_response = await client.post(
        "/api/v1/media/presign-upload",
        headers=auth_headers("admin_media_uploader"),
        json={
            "file_name": "vehicle-left.jpg",
            "content_type": "image/jpeg",
            "file_size": 2048,
            "entity_type": "vehicle",
            "entity_id": str(vehicle_id),
            "slot_key": "vehicle_left",
        },
    )

    assert presign_response.status_code == 200
    object_key = presign_response.json()["object_key"]

    confirm_response = await client.post(
        "/api/v1/media/confirm",
        headers=auth_headers("admin_media_uploader"),
        json={
            "entity_type": "vehicle",
            "entity_id": str(vehicle_id),
            "object_key": object_key,
            "slot_key": "vehicle_left",
        },
    )

    assert confirm_response.status_code == 201
    assert confirm_response.json()["media_file"]["entity_id"] == str(vehicle_id)
    assert confirm_response.json()["media_file"]["slot_key"] == "vehicle_left"

    async with session_factory() as session:
        vehicle = await session.get(Vehicle, vehicle_id)
        media_rows = (
            await session.execute(
                select(MediaFile).where(MediaFile.entity_type == "vehicle", MediaFile.entity_id == vehicle_id)
            )
        ).scalars().all()

    assert vehicle is not None
    assert vehicle.moderation_status == ModerationStatus.approved.value
    assert len(media_rows) == 1
    assert media_rows[0].public_url == f"https://cdn.example.com/{object_key}"


async def test_driver_media_upload_uses_driver_token_and_resets_vehicle_to_pending(client, session_factory, monkeypatch):
    monkeypatch.setattr("app.api.media.get_storage_service", lambda: FakeStorageService())

    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        driver_user = await create_user(session, username="+79990010808", role=driver_role)
        delivery_option = await create_delivery_option(session, capacity_m3=12.0, title="Самосвал 12 м3")
        vehicle = Vehicle(
            title="Approved vehicle",
            brand="Shacman",
            plate_number="Е111ЕЕ72",
            delivery_option_id=delivery_option.id,
            is_active=True,
            moderation_status=ModerationStatus.approved.value,
        )
        session.add(vehicle)
        await session.flush()
        driver = Driver(
            name="Media Driver",
            phone="+79990010808",
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            status="offline",
            moderation_status=ModerationStatus.approved.value,
        )
        session.add(driver)
        await session.commit()
        vehicle_id = vehicle.id

    presign_response = await client.post(
        "/api/v1/media/presign-upload",
        headers=auth_headers("+79990010808"),
        json={
            "file_name": "vehicle-main.jpg",
            "content_type": "image/jpeg",
            "file_size": 2048,
            "slot_key": "vehicle_main",
        },
    )

    assert presign_response.status_code == 200
    object_key = presign_response.json()["object_key"]

    confirm_response = await client.post(
        "/api/v1/media/confirm",
        headers=auth_headers("+79990010808"),
        json={
            "entity_id": str(vehicle_id),
            "entity_type": "vehicle",
            "object_key": object_key,
            "slot_key": "vehicle_main",
        },
    )

    assert confirm_response.status_code == 201
    assert confirm_response.json()["media_file"]["slot_key"] == "vehicle_main"

    async with session_factory() as session:
        vehicle = await session.get(Vehicle, vehicle_id)
        media_rows = (
            await session.execute(
                select(MediaFile).where(MediaFile.entity_type == "vehicle", MediaFile.entity_id == vehicle_id)
            )
        ).scalars().all()

    assert vehicle is not None
    assert vehicle.moderation_status == ModerationStatus.incomplete.value
    assert len(media_rows) == 1
    assert media_rows[0].public_url == f"https://cdn.example.com/{object_key}"


@pytest.mark.asyncio
async def test_vehicle_enters_pending_only_after_third_required_photo(client, session_factory, monkeypatch):
    monkeypatch.setattr("app.api.media.get_storage_service", lambda: FakeStorageService())

    async with session_factory() as session:
        driver_role = await ensure_role(session, "driver")
        driver_user = await create_user(session, username="+79990011212", role=driver_role)
        delivery_option = await create_delivery_option(session, capacity_m3=12.0, title="Самосвал 12 м3")
        driver = Driver(
            name="Pending After Third Photo",
            phone="+79990011212",
            user_id=driver_user.id,
            status="offline",
            moderation_status=ModerationStatus.incomplete.value,
        )
        session.add(driver)
        await session.commit()
        delivery_option_id = delivery_option.id

    vehicle_response = await client.patch(
        "/api/v1/driver/vehicle",
        headers=auth_headers("+79990011212"),
        json={
            "brand": "КамАЗ",
            "model": "65115",
            "plate_number": "О777ОО72",
            "vehicle_type": "Самосвал",
            "body_volume_m3": 12.0,
            "delivery_option_id": str(delivery_option_id),
        },
    )
    assert vehicle_response.status_code == 200
    vehicle_id = vehicle_response.json()["vehicle"]["id"]
    assert vehicle_response.json()["vehicle"]["moderation_status"] == ModerationStatus.incomplete.value

    for slot_key, expected_status in (
        ("vehicle_main", ModerationStatus.incomplete.value),
        ("vehicle_left", ModerationStatus.incomplete.value),
        ("vehicle_plate", ModerationStatus.pending_moderation.value),
    ):
        presign_response = await client.post(
            "/api/v1/media/presign-upload",
            headers=auth_headers("+79990011212"),
            json={
                "file_name": f"{slot_key}.jpg",
                "content_type": "image/jpeg",
                "file_size": 2048,
                "slot_key": slot_key,
            },
        )
        assert presign_response.status_code == 200

        confirm_response = await client.post(
            "/api/v1/media/confirm",
            headers=auth_headers("+79990011212"),
            json={
                "entity_id": vehicle_id,
                "entity_type": "vehicle",
                "object_key": presign_response.json()["object_key"],
                "slot_key": slot_key,
            },
        )
        assert confirm_response.status_code == 201

        profile_response = await client.get(
            "/api/v1/driver/profile/full",
            headers=auth_headers("+79990011212"),
        )
        assert profile_response.status_code == 200
        assert profile_response.json()["moderation_status"] == expected_status
        assert profile_response.json()["vehicle"]["moderation_status"] == expected_status


@pytest.mark.asyncio
async def test_admin_pending_moderation_route_registers_both_variants():
    paths = {route.path for route in app.routes if getattr(route, "methods", None) and "GET" in route.methods}
    assert "/api/v1/admin/moderation/pending" in paths
    assert "/api/v1/admin/moderation/pending/" in paths


@pytest.mark.asyncio
async def test_admin_pending_moderation_endpoint_returns_aggregated_queue(client, session_factory):
    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        driver_role = await ensure_role(session, "driver")
        admin_user = await create_user(session, username="pending_queue_admin", role=admin_role)
        pending_driver_user = await create_user(session, username="+79990010909", role=driver_role)
        approved_driver_user = await create_user(session, username="+79990011010", role=driver_role)
        delivery_option = await create_delivery_option(session, capacity_m3=16.0, title="Самосвал 16 м3")

        pending_vehicle = Vehicle(
            title="Pending queue vehicle",
            brand="КАМАЗ",
            model="65115",
            plate_number="К001КК72",
            vehicle_type="самосвал",
            cubature_min=14.0,
            cubature_max=16.0,
            tonnage_min=10.0,
            tonnage_max=12.0,
            delivery_option_id=delivery_option.id,
            is_active=True,
            moderation_status=ModerationStatus.pending_moderation.value,
        )
        incomplete_vehicle = Vehicle(
            title="Incomplete queue vehicle",
            brand="МАЗ",
            delivery_option_id=delivery_option.id,
            is_active=True,
            moderation_status=ModerationStatus.pending_moderation.value,
        )
        approved_vehicle = Vehicle(
            title="Approved queue vehicle",
            brand="MAN",
            plate_number="М002ММ72",
            body_volume_m3=20.0,
            delivery_option_id=delivery_option.id,
            is_active=True,
            moderation_status=ModerationStatus.approved.value,
        )
        session.add_all([pending_vehicle, incomplete_vehicle, approved_vehicle])
        await session.flush()

        pending_driver = Driver(
            name="Pending Queue Driver",
            phone="+79990010909",
            user_id=pending_driver_user.id,
            vehicle_id=pending_vehicle.id,
            status="offline",
            moderation_status=ModerationStatus.pending_moderation.value,
        )
        approved_driver = Driver(
            name="Approved Queue Driver",
            phone="+79990011010",
            user_id=approved_driver_user.id,
            vehicle_id=approved_vehicle.id,
            status="offline",
            moderation_status=ModerationStatus.approved.value,
        )
        incomplete_driver_user = await create_user(session, username="+79990011313", role=driver_role)
        incomplete_driver = Driver(
            name="Incomplete Queue Driver",
            phone="+79990011313",
            user_id=incomplete_driver_user.id,
            vehicle_id=incomplete_vehicle.id,
            status="offline",
            moderation_status=ModerationStatus.pending_moderation.value,
        )
        session.add_all([pending_driver, approved_driver, incomplete_driver])
        await session.flush()

        session.add_all(
            [
                MediaFile(
                    entity_type="vehicle",
                    entity_id=pending_vehicle.id,
                    bucket="demo",
                    object_key="vehicles/pending-main.jpg",
                    public_url="https://example.com/main.jpg",
                    content_type="image/jpeg",
                    file_name="main.jpg",
                    file_size=100,
                    slot_key="vehicle_main",
                ),
                MediaFile(
                    entity_type="vehicle",
                    entity_id=pending_vehicle.id,
                    bucket="demo",
                    object_key="vehicles/pending-left.jpg",
                    public_url="https://example.com/left.jpg",
                    content_type="image/jpeg",
                    file_name="left.jpg",
                    file_size=100,
                    slot_key="vehicle_left",
                ),
                MediaFile(
                    entity_type="vehicle",
                    entity_id=pending_vehicle.id,
                    bucket="demo",
                    object_key="vehicles/pending-plate.jpg",
                    public_url="https://example.com/plate.jpg",
                    content_type="image/jpeg",
                    file_name="plate.jpg",
                    file_size=100,
                    slot_key="vehicle_plate",
                ),
            ]
        )
        await session.commit()
        admin_username = admin_user.username

    response = await client.get(
        "/api/v1/admin/moderation/pending",
        headers=auth_headers(admin_username),
    )

    assert response.status_code == 200
    payload = response.json()
    pending_item = next(item for item in payload if item["driver_name"] == "Pending Queue Driver")
    assert pending_item["driver_phone"] == "+79990010909"
    assert pending_item["vehicle_brand"] == "КАМАЗ"
    assert pending_item["vehicle_plate_number"] == "К001КК72"
    assert pending_item["vehicle_type"] == "самосвал"
    assert pending_item["vehicle_cubature_min"] == 14.0
    assert pending_item["vehicle_cubature_max"] == 16.0
    assert pending_item["vehicle_tonnage_min"] == 10.0
    assert pending_item["vehicle_tonnage_max"] == 12.0
    assert pending_item["vehicle_main_url"] == "https://example.com/main.jpg"
    assert pending_item["vehicle_left_url"] == "https://example.com/left.jpg"
    assert pending_item["vehicle_plate_url"] == "https://example.com/plate.jpg"
    assert all(item["driver_name"] != "Incomplete Queue Driver" for item in payload)


@pytest.mark.asyncio
async def test_admin_vehicle_patch_decisions_sync_driver_moderation(client, session_factory):
    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        driver_role = await ensure_role(session, "driver")
        admin_user = await create_user(session, username="vehicle_patch_admin", role=admin_role)
        driver_user = await create_user(session, username="+79990011111", role=driver_role)
        delivery_option = await create_delivery_option(session, capacity_m3=14.0, title="Самосвал 14 м3")
        vehicle = Vehicle(
            title="Patch moderation vehicle",
            delivery_option_id=delivery_option.id,
            is_active=True,
            moderation_status=ModerationStatus.pending_moderation.value,
        )
        session.add(vehicle)
        await session.flush()
        driver = Driver(
            name="Patch moderation driver",
            phone="+79990011111",
            user_id=driver_user.id,
            vehicle_id=vehicle.id,
            status="offline",
            moderation_status=ModerationStatus.pending_moderation.value,
        )
        session.add(driver)
        await session.commit()
        vehicle_id = vehicle.id
        driver_id = driver.id
        admin_username = admin_user.username

    reject_response = await client.patch(
        f"/api/v1/admin/vehicles/{vehicle_id}/reject",
        headers=auth_headers(admin_username),
        json={"reject_reason": "Фото номера мутное"},
    )
    assert reject_response.status_code == 200
    assert reject_response.json()["moderation_status"] == ModerationStatus.rejected.value
    assert reject_response.json()["driver_moderation_status"] == ModerationStatus.rejected.value
    assert reject_response.json()["moderation_comment"] == "Фото номера мутное"

    approve_response = await client.patch(
        f"/api/v1/admin/vehicles/{vehicle_id}/approve",
        headers=auth_headers(admin_username),
        json={"comment": "Все фото читаемые"},
    )
    assert approve_response.status_code == 200
    assert approve_response.json()["moderation_status"] == ModerationStatus.approved.value
    assert approve_response.json()["driver_moderation_status"] == ModerationStatus.approved.value

    orders_response = await client.get(
        "/api/v1/driver/orders",
        headers=auth_headers("+79990011111"),
    )
    assert orders_response.status_code == 200
    assert orders_response.json() == []

    async with session_factory() as session:
        vehicle = await session.get(Vehicle, vehicle_id)
        driver = await session.get(Driver, driver_id)

    assert vehicle is not None
    assert driver is not None
    assert vehicle.moderation_status == ModerationStatus.approved.value
    assert driver.moderation_status == ModerationStatus.approved.value
    assert driver.status == "available"
