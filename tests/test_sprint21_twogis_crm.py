import pytest
import httpx
from fastapi import HTTPException
from sqlalchemy import select

from app.models.models import CrmStatus, PointAuditLog, Quarry, Role, User
from app.security.jwt import create_access_token
from app.services.pickup_points import is_pickup_point_publicly_available
from app.schemas.parser import ParserRunRequest
from app.services.twogis_places import ParsedPlace, _fetch_page, _normalize_place, _skip_reason, search_places


def auth_headers(username: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(data={'sub': username})}"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("response_status", "response_payload"),
    [
        (403, {"meta": {"code": 403, "error": {"message": "Access denied"}}}),
        (200, {"meta": {"code": 403, "error": {"message": "Access denied"}}}),
    ],
)
async def test_places_access_error_is_exposed(response_status, response_payload):
    transport = httpx.MockTransport(
        lambda request: httpx.Response(response_status, json=response_payload)
    )
    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(HTTPException) as exc_info:
            await _fetch_page(client, {})

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Ошибка 2ГИС: Нет доступа к Places API. Проверьте лимиты ключа."


@pytest.mark.asyncio
async def test_places_meta_error_keeps_twogis_message():
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200,
            json={"meta": {"code": 429, "error": {"message": "Rate limit exceeded"}}},
        )
    )
    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(HTTPException) as exc_info:
            await _fetch_page(client, {})

    assert exc_info.value.status_code == 429
    assert exc_info.value.detail == "Ошибка 2ГИС: Rate limit exceeded"


@pytest.mark.asyncio
async def test_places_search_uses_ten_item_pages_until_result_limit(monkeypatch):
    requested_pages: list[int] = []

    class MockAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, _url, *, params):
            page = int(params["page"])
            requested_pages.append(page)
            assert params["page_size"] == 10
            offset = (page - 1) * 10
            return httpx.Response(
                200,
                json={
                    "result": {
                        "total": 30,
                        "items": [
                            {
                                "id": f"2gis-{index}",
                                "name": f"Place {index}",
                                "full_address_name": f"Tyumen, Test road, {index}",
                                "point": {"lat": 57.15, "lon": 65.53},
                            }
                            for index in range(offset, offset + 10)
                        ],
                    }
                },
            )

    monkeypatch.setattr("app.services.twogis_places.httpx.AsyncClient", lambda **_kwargs: MockAsyncClient())
    monkeypatch.setattr("app.services.twogis_places.settings.TWOGIS_API_KEY", "test-key")
    monkeypatch.setattr("app.services.twogis_places.settings.TWOGIS_PLACES_MAX_RESULTS", 30)

    places, truncated = await search_places(
        ParserRunRequest(
            city="Tyumen",
            center_lat=57.15,
            center_lon=65.53,
            radius_m=1000,
            target="material",
            keyword="sand",
        )
    )

    assert requested_pages == [1, 2, 3]
    assert len(places) == 30
    assert truncated is False


@pytest.mark.asyncio
async def test_places_search_stops_after_five_pages(monkeypatch):
    requested_pages: list[int] = []

    class MockAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, _url, *, params):
            page = int(params["page"])
            requested_pages.append(page)
            offset = (page - 1) * 10
            return httpx.Response(
                200,
                json={
                    "result": {
                        "total": 100,
                        "items": [
                            {
                                "id": f"2gis-{index}",
                                "name": f"Place {index}",
                                "full_address_name": f"Tyumen, Test road, {index}",
                                "point": {"lat": 57.15, "lon": 65.53},
                            }
                            for index in range(offset, offset + 10)
                        ],
                    }
                },
            )

    monkeypatch.setattr("app.services.twogis_places.httpx.AsyncClient", lambda **_kwargs: MockAsyncClient())
    monkeypatch.setattr("app.services.twogis_places.settings.TWOGIS_API_KEY", "test-key")
    monkeypatch.setattr("app.services.twogis_places.settings.TWOGIS_PLACES_MAX_RESULTS", 1000)

    places, truncated = await search_places(
        ParserRunRequest(city="Tyumen", center_lat=57.15, center_lon=65.53, radius_m=1000, target="material", keyword="sand")
    )

    assert requested_pages == [1, 2, 3, 4, 5]
    assert len(places) == 50
    assert truncated is True


@pytest.mark.asyncio
async def test_places_search_returns_collected_items_when_next_page_is_unavailable(monkeypatch):
    requested_pages: list[int] = []

    class MockAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, _url, *, params):
            page = int(params["page"])
            requested_pages.append(page)
            if page == 2:
                return httpx.Response(400, json={"detail": "page is out of range"})
            return httpx.Response(
                200,
                json={
                    "result": {
                        "total": 20,
                        "items": [
                            {
                                "id": f"2gis-{index}",
                                "name": f"Place {index}",
                                "full_address_name": f"Tyumen, Test road, {index}",
                                "point": {"lat": 57.15, "lon": 65.53},
                            }
                            for index in range(10)
                        ],
                    }
                },
            )

    monkeypatch.setattr("app.services.twogis_places.httpx.AsyncClient", lambda **_kwargs: MockAsyncClient())
    monkeypatch.setattr("app.services.twogis_places.settings.TWOGIS_API_KEY", "test-key")

    places, truncated = await search_places(
        ParserRunRequest(city="Tyumen", center_lat=57.15, center_lon=65.53, radius_m=1000, target="material", keyword="sand")
    )

    assert requested_pages == [1, 2]
    assert len(places) == 10
    assert truncated is False


def test_places_search_does_not_filter_by_rubric():
    for rubric_name in (
        "Институт образования",
        "Школа",
        "Товары для сада",
        "Водомат",
        "Магазин",
        "Офис продаж",
        "Торговый дом",
        "Павильон",
        "Супермаркет",
        "Гипермаркет",
        "Кадровое агентство",
        "Персонал",
        "Карьерный сервис",
        "Обучение работе с техникой",
        "Автомат",
        "Розлив воды",
        "Кулер",
        "Рыбный магазин",
        "Логистическая компания",
    ):
        allowed_item = {
            "id": f"2gis-{rubric_name}",
            "name": "Поставщик воды",
            "full_address_name": "Tyumen, Test road, 2",
            "point": {"lat": 57.15, "lon": 65.53},
            "rubrics": [{"name": rubric_name}],
        }

        assert _skip_reason(allowed_item) is None
        assert _normalize_place(allowed_item) is not None


def test_places_search_skips_items_with_missing_required_data():
    invalid_item = {
        "id": "2gis-without-coordinates",
        "name": "Товары для сада",
        "full_address_name": "Tyumen, Test road, 2",
        "rubrics": [{"name": "Товары для сада"}],
    }

    assert _skip_reason(invalid_item) == "Нет координат"


def test_parser_allows_custom_keyword():
    payload = ParserRunRequest(
        city="Tyumen",
        center_lat=57.15,
        center_lon=65.53,
        radius_m=1000,
        target="material",
        keyword="керамзит",
    )

    assert payload.keyword == "керамзит"


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
            crm_status=CrmStatus.hidden.value,
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
    assert updated.crm_status == CrmStatus.hidden.value
    assert updated.crm_comment == "Manual CRM decision"
    assert updated.parsed_data["phones"] == ["+79990000002"]
