"""Exercise vehicle RBAC through HTTP without a database or external services."""
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from app.api import admin
from app.db.database import get_db
from app.security.auth import get_current_user


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["admin", "logist", "driver", "supplier"])
@pytest.mark.parametrize("method,path,payload", [
    ("GET", "/drivers/{driver_id}", None),
    ("GET", "/vehicles", None),
    ("GET", "/drivers/{driver_id}/vehicles", None),
    ("PATCH", "/drivers/{driver_id}/vehicle", {"create_new_vehicle": True}),
    ("PATCH", "/drivers/{driver_id}/vehicle", {"vehicle_brand": "КАМАЗ"}),
])
async def test_vehicle_routes_allow_admin_and_logist_only(monkeypatch, role, method, path, payload):
    app = FastAPI()
    app.include_router(admin.router)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
        id=uuid4(), role=SimpleNamespace(name=role),
    )
    app.dependency_overrides[get_db] = lambda: AsyncMock()

    # A missing resource proves that authorization passed and the handler ran.
    missing = HTTPException(status_code=404, detail="Test resource not found")
    load_driver = AsyncMock(side_effect=missing)
    list_vehicles = AsyncMock(side_effect=missing)
    monkeypatch.setattr(admin, "_load_driver_or_404", load_driver)
    monkeypatch.setattr(admin, "_list_admin_vehicles", list_vehicles)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.request(method, path.format(driver_id=uuid4()), json=payload)

    if role in {"admin", "logist"}:
        assert response.status_code == 404
        assert response.json()["detail"] == "Test resource not found"
        assert load_driver.await_count + list_vehicles.await_count == 1
    else:
        assert response.status_code == 403
        load_driver.assert_not_awaited()
        list_vehicles.assert_not_awaited()
