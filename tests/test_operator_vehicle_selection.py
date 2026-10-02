"""Vehicle assignment regressions; no database or external services are used."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api import admin
from app.models.models import Vehicle
from app.schemas.driver import OperatorDriverVehicleUpdate


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
