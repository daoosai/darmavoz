import pytest
from sqlalchemy import select

from app.models.models import CrmStatus, PointAuditLog, Quarry, Role, User
from app.security.jwt import create_access_token
from app.services.pickup_points import is_pickup_point_publicly_available
from app.services.twogis_places import ParsedPlace


def auth_headers(username: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(data={'sub': username})}"}


async def ensure_role(session, name: str) -> Role:
    role = await session.scalar(select(Role).where(Role.name == name))
    if role is None:
        role = Role(name=name, description=name)
        session.add(role)
        await session.flush()
    return role


async def create_user(session, *, username: str, role: Role) -> User:
    user = User(username=username, hashed_password="hash", role_id=role.id, is_active=True)
    session.add(user)
    await session.flush()
    return user


@pytest.mark.asyncio
async def test_admin_parser_creates_parsed_quarry_and_audit_log(client, session_factory, monkeypatch):
    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        await create_user(session, username="sprint21_parser_admin", role=admin_role)
        await session.commit()

    async def fake_search_places(_payload):
        return [
            ParsedPlace(
                twogis_id="2gis-test-1",
                name="2GIS Sand Quarry",
                address="Tyumen, Test road, 1",
                lat=57.15,
                lon=65.53,
                phone="+79990000000",
                parsed_data={"phones": ["+79990000000"], "schedule": {"Mon": "09:00-18:00"}, "raw": {}},
            )
        ], False

    monkeypatch.setattr("app.api.admin_parser.search_places", fake_search_places)
    response = await client.post(
        "/api/v1/admin/parser/run",
        headers=auth_headers("sprint21_parser_admin"),
        json={
            "city": "Tyumen",
            "center_lat": 57.15,
            "center_lon": 65.53,
            "radius_m": 1000,
            "target": "material",
            "keyword": "песок",
        },
    )

    assert response.status_code == 200
    assert response.json()["created"] == 1

    async with session_factory() as session:
        point = await session.scalar(select(Quarry).where(Quarry.twogis_id == "2gis-test-1"))
        audit_log = await session.scalar(select(PointAuditLog).where(PointAuditLog.point_id == point.id))

    assert point is not None
    assert point.owner_user_id is None
    assert point.crm_status == CrmStatus.parsed.value
    assert point.parsed_data["phones"] == ["+79990000000"]
    assert audit_log is not None
    assert audit_log.old_status is None
    assert audit_log.new_status == CrmStatus.parsed.value
    assert not is_pickup_point_publicly_available(point)


@pytest.mark.asyncio
async def test_parser_upsert_keeps_crm_fields_and_only_updates_parsed_data(client, session_factory, monkeypatch):
    async with session_factory() as session:
        admin_role = await ensure_role(session, "admin")
        admin = await create_user(session, username="sprint21_upsert_admin", role=admin_role)
        point = Quarry(
            name="Manual quarry name",
            short_name="Manual quarry name",
            point_type="quarry",
            address="Manual address",
            lat=57.15,
            lon=65.53,
            contact_phone="+79990000001",
            owner_user_id=admin.id,
            crm_status=CrmStatus.rejected.value,
            crm_comment="Manual CRM decision",
            twogis_id="2gis-existing",
            parsed_data={"phones": ["old"]},
        )
        session.add(point)
        await session.commit()

    async def fake_search_places(_payload):
        return [
            ParsedPlace(
                twogis_id="2gis-existing",
                name="External name must not overwrite",
                address="External address must not overwrite",
                lat=57.0,
                lon=65.0,
                phone="+79990000002",
                parsed_data={"phones": ["+79990000002"], "schedule": {"Tue": "10:00-19:00"}, "raw": {}},
            )
        ], False

    monkeypatch.setattr("app.api.admin_parser.search_places", fake_search_places)
    response = await client.post(
        "/api/v1/admin/parser/run",
        headers=auth_headers("sprint21_upsert_admin"),
        json={"city": "Tyumen", "center_lat": 57.15, "center_lon": 65.53, "radius_m": 1000, "target": "material", "keyword": "песок"},
    )

    assert response.status_code == 200
    assert response.json()["updated"] == 1
    async with session_factory() as session:
        updated = await session.scalar(select(Quarry).where(Quarry.twogis_id == "2gis-existing"))

    assert updated.name == "Manual quarry name"
    assert updated.address == "Manual address"
    assert updated.owner_user_id is not None
    assert updated.crm_status == CrmStatus.rejected.value
    assert updated.crm_comment == "Manual CRM decision"
    assert updated.parsed_data["phones"] == ["+79990000002"]
