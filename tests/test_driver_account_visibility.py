"""Operational lists must agree with dispatch about disabled/deleted accounts."""

from types import SimpleNamespace
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models.models import City, Driver, Role, TransportCategory, User, Vehicle
from app.services.driver_eligibility import driver_constraints


@pytest_asyncio.fixture
async def fleet(session_factory):
    prefix = "account-visibility-" + uuid4().hex
    async with session_factory() as db:
        role = await db.scalar(select(Role).where(Role.name == "driver"))
        if role is None:
            role = Role(name="driver", description="Driver")
            db.add(role)
            await db.flush()
        city = await db.scalar(select(City).where(City.code == "tyumen"))
        category = TransportCategory(
            slug=prefix,
            title=prefix,
            capacity_min_m3=1,
            capacity_max_m3=40,
            is_active=True,
        )
        db.add(category)
        await db.flush()
        drivers = {}
        for index, kind in enumerate(
            (
                "driver_disabled",
                "user_disabled",
                "user_deleted",
                "user_deleted_disabled",
                "active",
                "busy",
                "unlinked",
            )
        ):
            user = None
            if kind != "unlinked":
                user = User(
                    username=uuid4().hex,
                    hashed_password="unused",
                    role_id=role.id,
                    is_active=kind
                    not in (
                        "user_disabled",
                        "user_deleted_disabled",
                    ),
                    is_deleted=kind in ("user_deleted", "user_deleted_disabled"),
                )
                db.add(user)
                await db.flush()
            vehicle = Vehicle(
                title=prefix + kind,
                body_volume_m3=30,
                cubature_max=30,
                transport_category_id=category.id,
                is_active=True,
                moderation_status="approved",
            )
            db.add(vehicle)
            await db.flush()
            driver = Driver(
                name=f"{prefix}-{index}-{kind}",
                phone=f"+7{uuid4().int % 10**10:010d}",
                user_id=user.id if user else None,
                vehicle_id=vehicle.id,
                is_active=kind != "driver_disabled",
                is_on_shift=False,
                status="busy" if kind == "busy" else "available",
                moderation_status="approved",
            )
            db.add(driver)
            await db.flush()
            drivers[kind] = driver.id
        await db.commit()
        return prefix, drivers, city.id, category.id


@pytest.mark.asyncio
async def test_operational_lists_and_manual_admission(
    client,
    session_factory,
    admin_token,
    fleet,
    monkeypatch,
):
    prefix, drivers, city_id, category_id = fleet

    async def empty_cache(ids):
        return {}

    monkeypatch.setattr(
        "app.services.driver_locations._load_cached_locations",
        empty_cache,
    )
    headers = {"Authorization": f"Bearer {admin_token}"}
    allowed = {str(drivers[k]) for k in ("active", "busy", "unlinked")}
    fixture_ids = {str(v) for v in drivers.values()}
    # Disabled rows sort first: SQL filtering must happen before pagination.
    result = await client.get(
        "/api/v1/admin/drivers",
        params={"q": prefix, "limit": 1},
        headers=headers,
    )
    assert result.status_code == 200, result.text
    assert [d["id"] for d in result.json()] == [str(drivers["active"])]
    for path, key, expected in (
        ("/api/v1/admin/drivers", "id", allowed),
        ("/api/v1/admin/cars", "driver", allowed),
        ("/api/v1/drivers/", "id", allowed - {str(drivers["unlinked"])}),
        ("/api/v1/logist/driver-map", "id", allowed - {str(drivers["unlinked"])}),
    ):
        result = await client.get(path, headers=headers)
        assert result.status_code == 200, result.text
        ids = {
            item[key]["id"] if key == "driver" else item[key] for item in result.json()
        } & fixture_ids
        assert ids == expected, (path, ids, expected)
    async with session_factory() as db:
        order = SimpleNamespace(
            id=uuid4(),
            city_id=city_id,
            transport_category_id=category_id,
            delivery_option=None,
        )
        for automatic, expected in (
            (False, {drivers["active"], drivers["unlinked"]}),
            (True, set()),
        ):
            admitted = set(
                await db.scalars(
                    select(Driver.id)
                    .join(Driver.vehicle)
                    .where(
                        Driver.id.in_(drivers.values()),
                        driver_constraints(order, automatic=automatic),
                    )
                )
            )
            assert admitted == expected


@pytest.mark.asyncio
async def test_moderation_lists_and_counts_exclude_archived_accounts(
    client,
    session_factory,
    admin_token,
    fleet,
):
    _, drivers, _, _ = fleet
    headers = {"Authorization": f"Bearer {admin_token}"}
    paths = (
        "/api/v1/admin/drivers/pending-moderation/count",
        "/api/v1/admin/moderation/count",
    )
    before = []
    for path in paths:
        result = await client.get(path, headers=headers)
        assert result.status_code == 200, result.text
        before.append(result.json())
    async with session_factory() as db:
        for driver_id in drivers.values():
            driver = await db.get(Driver, driver_id)
            vehicle = await db.get(Vehicle, driver.vehicle_id)
            vehicle.moderation_status = "pending_moderation"
        await db.commit()
    for path, baseline in zip(paths, before):
        result = await client.get(path, headers=headers)
        assert result.status_code == 200, result.text
        key = "count" if "pending-moderation" in path else "drivers"
        assert result.json()[key] - baseline[key] == 3


@pytest.mark.asyncio
async def test_saved_recommendations_hide_currently_archived_accounts(
    session_factory, fleet
):
    from datetime import UTC, datetime
    from unittest.mock import AsyncMock

    from app.services.smart_matching import smart_matching_service

    _, drivers, _, _ = fleet
    rows = [{"driver_id": str(value)} for value in drivers.values()]
    record = SimpleNamespace(
        order_id=uuid4(),
        calculated_at=datetime.now(UTC),
        trigger_source="manual",
        algorithm_version="test",
        recommended_driver_id=drivers["user_deleted"],
        selected_driver_id=None,
        distance_source="haversine",
        twogis_status="not_requested",
        candidates_snapshot={"candidates": rows, "not_recommended": rows},
    )
    async with session_factory() as db:
        # The saved snapshot is simulated; account filtering uses the real database.
        session = SimpleNamespace(
            scalar=AsyncMock(return_value=record), scalars=db.scalars
        )
        result = await smart_matching_service.latest(session, record.order_id)
    expected = {str(drivers[k]) for k in ("active", "busy", "unlinked")}
    for key in ("candidates", "not_recommended"):
        assert {r["driver_id"] for r in result[key]} == expected
    assert result["recommended_driver_id"] is None
    assert len(record.candidates_snapshot["candidates"]) == 7
