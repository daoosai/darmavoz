"""Vehicle assignment regressions; no database or external services are used."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api import admin
from app.models.models import Vehicle
from app.schemas.driver import OperatorDriverVehicleUpdate


def test_vehicle_form_endpoints_are_registered():
    from main import app

    paths = app.openapi()["paths"]
    assert "get" in paths["/api/v1/admin/drivers/{driver_id}/vehicles"]
    assert "patch" in paths["/api/v1/admin/drivers/{driver_id}/vehicle"]
    assert "get" in paths["/api/v1/catalog/transport-categories"]
    assert "/api/v1/transport-categories" not in paths


@pytest.mark.asyncio
async def test_new_driver_without_vehicle_gets_empty_available_list(monkeypatch):
    driver = SimpleNamespace(id=uuid4(), name="New driver", vehicle=None, vehicle_id=None)
    db = AsyncMock()
    db.scalars.return_value = SimpleNamespace(all=lambda: [])
    monkeypatch.setattr(admin, "_load_driver_or_404", AsyncMock(return_value=driver))
    monkeypatch.setattr(admin, "_list_admin_vehicles", AsyncMock(return_value=[]))
    assert await admin.list_driver_available_vehicles(driver.id, db, SimpleNamespace(id=uuid4())) == []


@pytest.mark.asyncio
async def test_own_unmoderated_vehicle_is_selectable_but_other_drivers_vehicle_is_not(monkeypatch):
    own = Vehicle(id=uuid4(), title="Registration draft", is_active=True, moderation_status="incomplete")
    free = Vehicle(id=uuid4(), title="Free", is_active=True)
    occupied = Vehicle(id=uuid4(), title="Other driver", is_active=True)
    inactive = Vehicle(id=uuid4(), title="Disabled", is_active=False)
    driver = SimpleNamespace(id=uuid4(), vehicle_id=own.id, vehicle=own)
    db = AsyncMock()

    async def scalars(statement):
        # The current driver's assignment must be excluded from the occupied query.
        params = statement.compile().params
        excludes_current = driver.id in params.values() and "drivers.id !=" in str(statement)
        return SimpleNamespace(all=lambda: [occupied.id] if excludes_current else [own.id, occupied.id])

    db.scalars.side_effect = scalars
    monkeypatch.setattr(admin, "_load_driver_or_404", AsyncMock(return_value=driver))
    monkeypatch.setattr(admin, "_list_admin_vehicles", AsyncMock(return_value=[own, free, occupied, inactive]))
    assert await admin.list_driver_available_vehicles(driver.id, db, SimpleNamespace(id=uuid4())) == [own, free]


@pytest.mark.asyncio
async def test_registration_creates_and_links_vehicle_with_all_submitted_fields(monkeypatch):
    from app.api import auth
    from app.models.models import Driver, Role, User
    from app.schemas.driver import DriverRegisterRequest

    db = AsyncMock()
    db.add = MagicMock()
    role = Role(id=uuid4(), name="driver")
    monkeypatch.setattr(auth, "_get_or_create_driver_role", AsyncMock(return_value=role))
    monkeypatch.setattr(auth, "get_password_hash", lambda password: "test-only-hash")

    async def flush():
        for call in db.add.call_args_list:
            entity = call.args[0]
            if entity.id is None:
                entity.id = uuid4()

    db.flush.side_effect = flush
    result = MagicMock()
    result.scalar_one.side_effect = lambda: next(call.args[0] for call in db.add.call_args_list if isinstance(call.args[0], Driver))
    db.execute.return_value = result
    payload = DriverRegisterRequest(
        phone="+79991234567", password="driver123", name="Водитель",
        vehicle_brand="КАМАЗ", vehicle_plate_number="А123АА72", vehicle_type="Самосвал",
        cubature_min=10, cubature_max=14, tonnage_min=8, tonnage_max=12,
    )
    _, driver, user = await auth._create_driver_from_payload(db, payload=payload, normalized_phone=payload.phone)
    vehicle = next(call.args[0] for call in db.add.call_args_list if isinstance(call.args[0], Vehicle))
    assert isinstance(user, User)
    assert driver.user_id == user.id
    assert driver.vehicle_id == vehicle.id
    assert (vehicle.brand, vehicle.plate_number, vehicle.vehicle_type) == ("КАМАЗ", "А123АА72", "Самосвал")
    assert (vehicle.cubature_min, vehicle.cubature_max, vehicle.tonnage_min, vehicle.tonnage_max) == (10, 14, 8, 12)
    assert vehicle.transport_category_id is None
    assert vehicle.moderation_status == "incomplete"
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("create_new", [False, True])
async def test_creation_preserves_previous_vehicle_and_legacy_edit(monkeypatch, create_new):
    old = Vehicle(id=uuid4(), title="Previous", brand="Old", plate_number="OLD", is_active=True)
    driver = SimpleNamespace(id=uuid4(), name="Driver", vehicle=old, vehicle_id=old.id)
    db = AsyncMock()
    db.scalar.return_value = None
    db.add = MagicMock()

    async def flush():
        for call in db.add.call_args_list:
            vehicle = call.args[0]
            if isinstance(vehicle, Vehicle) and vehicle.id is None:
                vehicle.id = uuid4()

    db.flush.side_effect = flush
    monkeypatch.setattr(admin, "_load_driver_or_404", AsyncMock(return_value=driver))
    monkeypatch.setattr("app.services.vehicle_validation.validate_vehicle_capacity", AsyncMock())
    payload = OperatorDriverVehicleUpdate(
        create_new_vehicle=create_new, vehicle_brand="New", vehicle_plate_number="NEW",
        transport_category_id=uuid4(), cubature_min=10, cubature_max=20,
    )
    await admin.update_operator_driver_vehicle(driver.id, payload, db, SimpleNamespace(id=uuid4()))
    assert driver.vehicle.brand == "New"
    assert driver.vehicle.plate_number == "NEW"
    if create_new:
        assert driver.vehicle.id != old.id
        assert (old.brand, old.plate_number) == ("Old", "OLD")
    else:
        assert driver.vehicle is old
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_conflicting_selection_is_rejected_before_changes():
    db = AsyncMock()
    payload = OperatorDriverVehicleUpdate(vehicle_id=uuid4(), create_new_vehicle=True)
    with pytest.raises(HTTPException) as exc:
        await admin.update_operator_driver_vehicle(uuid4(), payload, db, SimpleNamespace(id=uuid4()))
    assert exc.value.status_code == 422
    db.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_existing_vehicle_uses_assignment_guard(monkeypatch):
    old = Vehicle(id=uuid4(), title="Previous", is_active=True)
    selected = Vehicle(id=uuid4(), title="Free", brand="Selected", is_active=True, transport_category_id=uuid4())
    driver = SimpleNamespace(id=uuid4(), name="Driver", vehicle=old, vehicle_id=old.id)
    db = AsyncMock()
    db.scalar.return_value = None
    db.add = MagicMock()
    guard = AsyncMock()
    monkeypatch.setattr(admin, "_load_driver_or_404", AsyncMock(return_value=driver))
    monkeypatch.setattr(admin, "_get_vehicle_or_404", AsyncMock(return_value=selected))
    monkeypatch.setattr(admin, "_ensure_vehicle_is_free", guard)
    monkeypatch.setattr("app.services.vehicle_validation.validate_vehicle_capacity", AsyncMock())
    await admin.update_operator_driver_vehicle(driver.id, OperatorDriverVehicleUpdate(vehicle_id=selected.id), db, SimpleNamespace(id=uuid4()))
    guard.assert_awaited_once_with(db, selected.id, exclude_driver_id=driver.id)
    assert driver.vehicle is selected
    assert driver.vehicle_id == selected.id
