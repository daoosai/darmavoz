import pytest
import httpx
from fastapi import HTTPException
from sqlalchemy import select

from app.models.models import CrmStatus, PointAuditLog, Quarry, Role, User
from app.security.jwt import create_access_token
from app.services.pickup_points import is_pickup_point_publicly_available
from app.schemas.parser import ParserRunRequest
from app.services.twogis_places import MATERIAL_SKIP_REASON, ParsedPlace, _fetch_page, _normalize_place, _skip_reason, search_places


def auth_headers(username: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(data={'sub': username})}"}


def test_normalize_place_maps_required_twogis_fields_to_db_payload():
    place = _normalize_place(
        {
            "id": "2gis-required-fields",
            "name": "Material base",
            "address_name": "Test street, 1",
            "point": {"lat": 57.15, "lon": 65.53},
            "contact_groups": [{"contacts": [
                {"type": "phone", "value": "+7 999 000-00-01"},
                {"type": "email", "value": "sale@example.test"},
            ]}],
            "links": [
                {"type": "website", "url": "https://materials.example.test"},
                {"type": "vkontakte", "url": "https://vk.com/materials"},
            ],
            "rubrics": [{"name": "Песок и щебень"}, {"name": "Строительные материалы"}],
            "schedule": {"Mon": "09:00-18:00"},
        }
    )

    assert place is not None
    assert place.name == "Material base"
    assert place.address == "Test street, 1"
    assert (place.lat, place.lon) == (57.15, 65.53)
    assert place.phone == "+7 999 000-00-01"
    assert place.parsed_data["rubrics"] == ["Песок и щебень", "Строительные материалы"]
    assert place.parsed_data["schedule"] == {"Mon": "09:00-18:00"}
    assert place.parsed_data["contacts"] == {
        "websites": ["https://materials.example.test"],
        "vk": ["https://vk.com/materials"],
        "emails": ["sale@example.test"],
        "other": [],
    }


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
            assert {
                "items.point",
                "items.address",
                "items.contact_groups",
                "items.rubrics",
                "items.schedule",
                "items.links",
            }.issubset(set(params["fields"].split(",")))
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
async def test_places_search_stops_after_fifty_valid_points(monkeypatch):
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
async def test_places_search_groups_non_target_skips_and_stops_after_twenty_pages(monkeypatch):
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
                        "total": 300,
                        "items": [
                            {
                                "id": f"2gis-school-{index}",
                                "name": f"Школа, филиал {index}",
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

    result = await search_places(
        ParserRunRequest(city="Tyumen", center_lat=57.15, center_lon=65.53, radius_m=1000, target="material", keyword="sand")
    )

    assert requested_pages == list(range(1, 21))
    assert result.places == []
    assert result.truncated is True
    assert len(result.skipped_items) == 1
    assert result.skipped_items[0].name == "Школа"
    assert result.skipped_items[0].reason == MATERIAL_SKIP_REASON
    assert result.skipped_items[0].count == 200


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


def test_water_search_keeps_existing_rubric_policy():
    for rubric_name in (
        "Строительный магазин",
        "Гипермаркет",
        "Пилорама",
        "Розничная торговля",
        "Товары для сада",
        "Офис продаж",
        "Торговый дом",
        "Павильон",
        "Кадровое агентство",
        "Персонал",
        "Карьерный сервис",
        "Обучение работе с техникой",
        "Автомат",
        "Розлив воды",
        "Кулер",
        "Логистическая компания",
    ):
        allowed_item = {
            "id": f"2gis-{rubric_name}",
            "name": "Поставщик воды",
            "full_address_name": "Tyumen, Test road, 2",
            "point": {"lat": 57.15, "lon": 65.53},
            "rubrics": [{"name": rubric_name}],
        }

        assert _skip_reason(allowed_item, "water") is None
        assert _normalize_place(allowed_item, "water") is not None


@pytest.mark.parametrize(
    ("name", "full_name", "rubric_name"),
    [
        ("Лемана ПРО", None, "Строительные материалы"),
        ("Карьер", "Супермаркет стройматериалов", "Песок"),
        ("База материалов", None, "Строительный магазин"),
        ("Пилорама Север", None, "Пиломатериалы"),
    ],
)
def test_water_search_keeps_existing_name_policy(name, full_name, rubric_name):
    item = {
        "id": "2gis-retail",
        "name": name,
        "full_address_name": "Tyumen, Test road, 2",
        "point": {"lat": 57.15, "lon": 65.53},
        "rubrics": [{"name": rubric_name}],
    }
    if full_name:
        item["full_name"] = full_name

    assert _skip_reason(item, "water") is None
    assert _normalize_place(item, "water") is not None


@pytest.mark.parametrize("value", ("Институт образования", "Школа", "Детский сад", "Водомат"))
def test_places_search_skips_only_non_target_organizations(value):
    item = {
        "id": "2gis-non-target",
        "name": "Проверочная точка",
        "full_address_name": "Tyumen, Test road, 2",
        "point": {"lat": 57.15, "lon": 65.53},
        "rubrics": [{"name": value}],
    }

    assert _skip_reason(item) == MATERIAL_SKIP_REASON
    assert _skip_reason(item, "water") == "Нецелевая категория"
    assert _normalize_place(item) is None


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


def material_item(name="Оптовая база стройматериалов", item_id="b2b-1"):
    return {
        "id": item_id,
        "name": name,
        "address_name": "Тюмень, Промышленная, 1",
        "point": {"lat": 57.15, "lon": 65.53},
        "rubrics": [{"name": "Песок и щебень"}, {"name": "Строительные материалы"}],
    }


@pytest.mark.parametrize("field", ("name", "full_name", "rubric"))
@pytest.mark.parametrize("value", (
    "Строительный двор", "СТРОИТЕЛЬНЫЙ-ДВОР", "Лемана ПРО", "Леруа Мерлен",
    "Leroy Merlin", "OBI", "ОБИ", "Касторама", "Castorama",
    "Строительный магазин", "Гипермаркеты", "Супермаркет", "Маркет",
    "Розничная торговля", "Розница", "Товары для сада", "Товары для дачи",
    "Отделочные материалы", "ВУЗ", "Курсы вождения", "Школа", "Институт",
))
def test_material_search_rejects_retail_in_all_name_fields(field, value):
    item = material_item()
    if field == "rubric":
        item["rubrics"].append({"name": value})
    else:
        item[field] = value
    assert _skip_reason(item) == MATERIAL_SKIP_REASON
    assert _normalize_place(item) is None


@pytest.mark.parametrize("name", (
    "МирГрад", "Альфа-групп", "Арт-Самосвал", "Тандем", "Арт-Техник",
    "Оптовая база стройматериалов", "Мобильный карьер", "Обилие",
    "Садовый карьер", "Дачный накопитель", "Карьерный сервис",
    "Торгово-транспортная компания", "Офис продаж нерудных материалов",
))
def test_material_candidates_are_not_rejected_by_ambiguous_words(name):
    assert _normalize_place(material_item(name)) is not None


@pytest.mark.asyncio
async def test_search_preserves_custom_query_and_encodes_once(monkeypatch):
    keyword = "  Песок  оптом + ПГС & щебень  "
    payload = ParserRunRequest(city="Тюмень", center_lat=57.15, center_lon=65.53,
                               radius_m=50000, target="material", keyword=keyword)
    assert payload.keyword == keyword

    def respond(request):
        assert request.url.params["q"] == keyword
        assert request.url.params["point"] == "65.53,57.15"
        assert request.url.params["radius"] == "50000"
        return httpx.Response(200, json={"result": {"total": 0, "items": []}})

    original_client = httpx.AsyncClient
    monkeypatch.setattr("app.services.twogis_places.settings.TWOGIS_API_KEY", "test-key")
    monkeypatch.setattr("app.services.twogis_places.httpx.AsyncClient",
                        lambda **kwargs: original_client(transport=httpx.MockTransport(respond), **kwargs))
    result = await search_places(payload)
    assert result.places == []
    assert not result.truncated


@pytest.mark.parametrize("keyword", ("", " ", "\t\n"))
def test_parser_rejects_blank_query(keyword):
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ParserRunRequest(city="Тюмень", center_lat=57.15, center_lon=65.53,
                         radius_m=50000, target="material", keyword=keyword)


@pytest.mark.asyncio
@pytest.mark.parametrize("valid_count", (30, 50))
async def test_search_digs_past_retail_and_duplicates_to_valid_limit(monkeypatch, valid_count):
    requested_pages = []
    retail = [material_item("Строительный двор", f"retail-{i}") for i in range(150)]
    valid = [material_item(item_id=f"valid-{i}") for i in range(valid_count)]
    # The 30-point case repeats ten retail branches; these must not be counted twice.
    items = retail + (retail[:10] if valid_count == 30 else []) + valid

    async def fetch_page(_client, params):
        page = params["page"]
        requested_pages.append(page)
        offset = (page - 1) * params["page_size"]
        return {"result": {"total": len(items), "items": items[offset:offset + params["page_size"]]}}

    monkeypatch.setattr("app.services.twogis_places.settings.TWOGIS_API_KEY", "test-key")
    monkeypatch.setattr("app.services.twogis_places._fetch_page", fetch_page)
    result = await search_places(ParserRunRequest(city="Тюмень", center_lat=57.15, center_lon=65.53,
                                                 radius_m=50000, target="material", keyword="песок оптом"))
    assert requested_pages == list(range(1, len(items) // 10 + 1))
    assert len(result.places) == valid_count
    assert len({place.twogis_id for place in result.places}) == valid_count
    assert sum(item.count for item in result.skipped_items) == 150
    assert result.skipped_items[0].reason == MATERIAL_SKIP_REASON
    assert not result.truncated


@pytest.mark.asyncio
async def test_search_does_not_hide_first_page_request_errors(monkeypatch):
    async def fetch_page(_client, _params):
        raise HTTPException(status_code=400, detail="Invalid radius")
    monkeypatch.setattr("app.services.twogis_places.settings.TWOGIS_API_KEY", "test-key")
    monkeypatch.setattr("app.services.twogis_places._fetch_page", fetch_page)
    with pytest.raises(HTTPException) as error:
        await search_places(ParserRunRequest(city="Тюмень", center_lat=57.15, center_lon=65.53,
                                             radius_m=50000, target="material", keyword="песок оптом"))
    assert error.value.status_code == 400


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
    preview = response.json()
    assert len(preview["items"]) == 1
    async with session_factory() as session:
        assert await session.scalar(select(Quarry).where(Quarry.twogis_id == "2gis-test-1")) is None
    saved = await client.post(
        "/api/v1/admin/parser/save",
        headers=auth_headers("sprint21_parser_admin"),
        json={"city": "Tyumen", "center_lat": 57.15, "center_lon": 65.53,
              "radius_m": 1000, "target": "material", "keyword": "песок оптом", "items": preview["items"]},
    )
    assert saved.status_code == 200
    assert saved.json()["created"] == 1

    async with session_factory() as session:
        point = await session.scalar(select(Quarry).where(Quarry.twogis_id == "2gis-test-1"))
        audit_log = await session.scalar(select(PointAuditLog).where(PointAuditLog.point_id == point.id))

    assert point is not None
    assert point.owner_user_id is None
    assert point.crm_status == CrmStatus.auto_added.value
    assert point.is_active is False
    assert point.parsed_data["phones"] == ["+79990000000"]
    assert audit_log is not None
    assert audit_log.old_status is None
    assert audit_log.new_status == CrmStatus.auto_added.value
    assert not is_pickup_point_publicly_available(point)


@pytest.mark.asyncio
async def test_parser_upsert_keeps_crm_fields_and_fills_missing_contact_phone(client, session_factory, monkeypatch):
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
            contact_phone=None,
            owner_user_id=admin.id,
            crm_status=CrmStatus.refused.value,
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
    preview = response.json()
    assert preview["items"][0]["is_update"] is True
    saved = await client.post(
        "/api/v1/admin/parser/save",
        headers=auth_headers("sprint21_upsert_admin"),
        json={"city": "Tyumen", "center_lat": 57.15, "center_lon": 65.53,
              "radius_m": 1000, "target": "material", "keyword": "песок оптом", "items": preview["items"]},
    )
    assert saved.status_code == 200
    assert saved.json()["updated"] == 1
    async with session_factory() as session:
        updated = await session.scalar(select(Quarry).where(Quarry.twogis_id == "2gis-existing"))

    assert updated.name == "Manual quarry name"
    assert updated.address == "Manual address"
    assert updated.owner_user_id is not None
    assert updated.crm_status == CrmStatus.refused.value
    assert updated.crm_comment == "Manual CRM decision"
    assert updated.contact_phone == "+79990000002"
    assert updated.parsed_data["phones"] == ["+79990000002"]
