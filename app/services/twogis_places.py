from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import Any, Iterator

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.models import CrmStatus, PointAuditLog, Quarry, WaterPoint
from app.schemas.parser import MATERIAL_KEYWORDS, ParserResultItem, ParserRunRequest, ParserRunResult, ParserSkippedItem


logger = logging.getLogger(__name__)
PHONE_PATTERN = re.compile(r"\+?[\d][\d\s()\-]{4,}[\d]")
MAX_PLACES_PAGES = 5
RETAIL_BLACKLIST = (
    "магазин",
    "гипермаркет",
    "супермаркет",
    "строительный двор",
    "лемана",
    "леруа",
    "obi",
    "оби",
    "касторама",
    "у михалыча",
    "пилорама",
    "дрова",
    "розница",
)
RETAIL_SKIP_REASON = "B2C розница / Сетевой магазин"
PLACES_FIELDS = ",".join(
    (
        "items.point",
        "items.address",
        "items.full_address_name",
        "items.contact_groups",
        "items.schedule",
        "items.rubrics",
        "items.links",
    )
)


@dataclass(frozen=True)
class ParsedPlace:
    twogis_id: str
    name: str
    address: str
    lat: float
    lon: float
    phone: str | None
    parsed_data: dict[str, Any]


@dataclass(frozen=True)
class PlacesSearchResult:
    places: list[ParsedPlace]
    truncated: bool
    skipped_items: list[ParserSkippedItem]

    def __iter__(self) -> Iterator[object]:
        yield self.places
        yield self.truncated


def _contact_value(contact: dict[str, Any]) -> str | None:
    for key in ("value", "text", "url", "href", "number"):
        value = contact.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _contact_bucket(contact_type: str, value: str) -> str:
    normalized_type = contact_type.casefold()
    normalized_value = value.casefold()
    if "vk" in normalized_type or "vkontakte" in normalized_type or "vk.com" in normalized_value:
        return "vk"
    if "email" in normalized_type or "e-mail" in normalized_type or "@" in value:
        return "emails"
    if (
        "site" in normalized_type
        or "web" in normalized_type
        or "url" in normalized_type
        or value.startswith(("http://", "https://"))
    ):
        return "websites"
    return "other"


def _iter_contact_records(item: dict[str, Any]) -> Iterator[dict[str, Any]]:
    groups = item.get("contact_groups")
    if isinstance(groups, list):
        for group in groups:
            if not isinstance(group, dict):
                continue
            contacts = group.get("contacts")
            if isinstance(contacts, list):
                yield from (contact for contact in contacts if isinstance(contact, dict))

    links = item.get("links")
    if isinstance(links, list):
        yield from (link for link in links if isinstance(link, dict))


def _extract_contacts(item: dict[str, Any]) -> tuple[list[str], dict[str, list[str]]]:
    phones: list[str] = []
    contacts: dict[str, list[str]] = {
        "websites": [],
        "vk": [],
        "emails": [],
        "other": [],
    }

    for contact in _iter_contact_records(item):
        value = _contact_value(contact)
        if not value:
            continue
        contact_type = str(contact.get("type") or contact.get("kind") or "")
        if "phone" in contact_type.casefold() or PHONE_PATTERN.search(value):
            phones.append(value)
            continue
        contacts[_contact_bucket(contact_type, value)].append(value)

    return list(dict.fromkeys(phones)), {
        key: list(dict.fromkeys(values)) for key, values in contacts.items()
    }


def _extract_rubric_names(item: dict[str, Any]) -> list[str]:
    rubrics = item.get("rubrics")
    if not isinstance(rubrics, list):
        return []

    names: list[str] = []
    for rubric in rubrics:
        if isinstance(rubric, str) and rubric.strip():
            names.append(rubric.strip())
        elif isinstance(rubric, dict) and isinstance(rubric.get("name"), str) and rubric["name"].strip():
            names.append(rubric["name"].strip())
    return list(dict.fromkeys(names))


def _item_name(item: object) -> str:
    if isinstance(item, dict) and isinstance(item.get("name"), str) and item["name"].strip():
        return item["name"].strip()
    return "Неизвестный объект"


def _is_retail_item(item: dict[str, Any]) -> bool:
    name_values = (item.get("name"), item.get("full_name"))
    text_values = [value for value in name_values if isinstance(value, str)]
    text_values.extend(_extract_rubric_names(item))
    return any(
        stop_word in value.casefold()
        for value in text_values
        for stop_word in RETAIL_BLACKLIST
    )


def _skip_reason(item: object) -> str | None:
    if not isinstance(item, dict):
        return "Некорректные данные 2ГИС"
    point = item.get("point")
    if not isinstance(point, dict):
        return "Нет координат"
    try:
        lat = float(point["lat"])
        lon = float(point["lon"])
    except (KeyError, TypeError, ValueError):
        return "Нет координат"
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return "Некорректные координаты"
    if not isinstance(item.get("id"), str) or not item["id"].strip():
        return "Нет идентификатора 2ГИС"
    if not isinstance(item.get("name"), str) or not item["name"].strip():
        return "Нет названия"
    address = item.get("full_address_name") or item.get("address_name")
    if not isinstance(address, str) or not address.strip():
        return "Нет адреса"
    if _is_retail_item(item):
        return RETAIL_SKIP_REASON
    return None


def _normalize_place(item: object) -> ParsedPlace | None:
    if not isinstance(item, dict):
        return None
    if _skip_reason(item):
        return None
    item_id = item.get("id")
    name = item.get("name")
    point = item.get("point")
    address = item.get("full_address_name") or item.get("address_name")
    if not isinstance(item_id, str) or not item_id.strip() or not isinstance(name, str) or not name.strip():
        return None
    if not isinstance(address, str) or not address.strip() or not isinstance(point, dict):
        return None
    try:
        lat = float(point["lat"])
        lon = float(point["lon"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None

    phones, contacts = _extract_contacts(item)
    parsed_data: dict[str, Any] = {
        "source": "2gis",
        "phones": phones,
        "websites": contacts["websites"],
        "contacts": contacts,
        "schedule": item.get("schedule"),
        "rubrics": _extract_rubric_names(item),
        "raw": item,
    }
    return ParsedPlace(
        twogis_id=item_id,
        name=name.strip(),
        address=address.strip(),
        lat=lat,
        lon=lon,
        phone=phones[0] if phones else None,
        parsed_data=parsed_data,
    )


def _places_error_message(payload: object, fallback: str) -> str:
    if not isinstance(payload, dict):
        return fallback

    meta = payload.get("meta")
    nested_error = meta.get("error") if isinstance(meta, dict) else None
    candidates = (
        nested_error.get("message") if isinstance(nested_error, dict) else None,
        nested_error if isinstance(nested_error, str) else None,
        payload.get("message"),
        payload.get("detail"),
        payload.get("error"),
    )
    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return fallback


async def _fetch_page(client: httpx.AsyncClient, params: dict[str, Any]) -> dict[str, Any]:
    response: httpx.Response | None = None
    for attempt in range(1, settings.TWOGIS_PLACES_MAX_RETRIES + 1):
        try:
            response = await client.get(settings.TWOGIS_PLACES_BASE_URL, params=params)
        except httpx.HTTPError:
            if attempt == settings.TWOGIS_PLACES_MAX_RETRIES:
                logger.exception("twogis_places_request_failed", extra={"attempt": attempt})
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="2GIS Places API is temporarily unavailable",
                )
            await asyncio.sleep(attempt)
            continue

        if response.status_code != status.HTTP_429_TOO_MANY_REQUESTS:
            break
        if attempt < settings.TWOGIS_PLACES_MAX_RETRIES:
            logger.warning("twogis_places_rate_limited", extra={"attempt": attempt})
            await asyncio.sleep(attempt)

    if response is None:
        logger.warning(
            "twogis_places_response_failed",
            extra={"status_code": None},
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="2GIS Places API is temporarily unavailable",
        )
    if response.status_code in {
        status.HTTP_401_UNAUTHORIZED,
        status.HTTP_403_FORBIDDEN,
    }:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ошибка 2ГИС: Нет доступа к Places API. Проверьте лимиты ключа.",
        )
    try:
        payload = response.json()
    except ValueError as exc:
        if response.status_code != status.HTTP_200_OK:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Ошибка 2ГИС: {response.reason_phrase or 'Places API returned an error'}",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Ошибка 2ГИС: Places API вернул некорректный ответ.",
        ) from exc
    if response.status_code != status.HTTP_200_OK:
        logger.warning(
            "twogis_places_response_failed",
            extra={"status_code": response.status_code},
        )
        raise HTTPException(
            status_code=response.status_code,
            detail=f"Ошибка 2ГИС: {_places_error_message(payload, response.reason_phrase)}",
        )
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Ошибка 2ГИС: Places API вернул некорректный ответ.",
        )
    meta = payload.get("meta")
    meta_code = meta.get("code") if isinstance(meta, dict) else None
    if isinstance(meta_code, int) and meta_code >= status.HTTP_400_BAD_REQUEST:
        if meta_code in {
            status.HTTP_401_UNAUTHORIZED,
            status.HTTP_403_FORBIDDEN,
        }:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Ошибка 2ГИС: Нет доступа к Places API. Проверьте лимиты ключа.",
            )
        raise HTTPException(
            status_code=meta_code,
            detail=f"Ошибка 2ГИС: {_places_error_message(payload, 'Places API returned an error')}",
        )
    return payload


async def search_places(payload: ParserRunRequest) -> PlacesSearchResult:
    if not settings.TWOGIS_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="2GIS Places API key is not configured",
        )

    collected: list[ParsedPlace] = []
    skipped_items: list[ParserSkippedItem] = []
    page = 1
    total: int | None = None
    # The 2GIS Places API accepts at most 10 items per page.
    page_size = min(10, settings.TWOGIS_PLACES_MAX_RESULTS)
    max_results = min(settings.TWOGIS_PLACES_MAX_RESULTS, page_size * MAX_PLACES_PAGES)
    base_params = {
        "key": settings.TWOGIS_API_KEY,
        "q": f"{payload.keyword}, {payload.city}",
        "type": "branch",
        "point": f"{payload.center_lon},{payload.center_lat}",
        "radius": payload.radius_m,
        "locale": "ru_RU",
        "fields": PLACES_FIELDS,
        "page_size": page_size,
    }

    async with httpx.AsyncClient(timeout=settings.TWOGIS_PLACES_TIMEOUT_SECONDS) as client:
        while len(collected) < max_results:
            if page > MAX_PLACES_PAGES:
                break
            try:
                response_payload = await _fetch_page(client, {**base_params, "page": page})
            except HTTPException as exc:
                if exc.status_code in {
                    status.HTTP_400_BAD_REQUEST,
                    status.HTTP_404_NOT_FOUND,
                }:
                    logger.info("twogis_places_pagination_complete", extra={"page": page, "status_code": exc.status_code})
                    break
                raise
            result = response_payload.get("result")
            if not isinstance(result, dict):
                break
            items = result.get("items")
            if not isinstance(items, list) or not items:
                break
            if isinstance(result.get("total"), int):
                total = result["total"]
            for item in items:
                reason = _skip_reason(item)
                if reason:
                    skipped_items.append(ParserSkippedItem(name=_item_name(item), reason=reason))
                    continue
                place = _normalize_place(item)
                if place is not None:
                    collected.append(place)
            if len(items) < page_size:
                break
            page += 1

    unique_places = list({place.twogis_id: place for place in collected}.values())
    truncated = bool(total is not None and total > len(unique_places) and len(unique_places) >= max_results)
    return PlacesSearchResult(
        places=unique_places[:max_results],
        truncated=truncated,
        skipped_items=skipped_items,
    )


async def upsert_places(
    db: AsyncSession,
    *,
    payload: ParserRunRequest,
    places: list[ParsedPlace],
    admin_id,
    truncated: bool,
    skipped_items: list[ParserSkippedItem] | None = None,
) -> ParserRunResult:
    result = ParserRunResult(
        found=len(places),
        total_found=len(places) + len(skipped_items or []),
        skipped=len(skipped_items or []),
        truncated=truncated,
        skipped_items=list(skipped_items or []),
    )
    destination_model = Quarry if payload.target == "material" else WaterPoint
    other_model = WaterPoint if payload.target == "material" else Quarry
    point_kind = "quarry" if payload.target == "material" else "water"
    point_type = MATERIAL_KEYWORDS.get(payload.keyword, "quarry")

    for place in places:
        existing = await db.scalar(select(destination_model).where(destination_model.twogis_id == place.twogis_id))
        if existing is not None:
            existing.parsed_data = place.parsed_data
            if place.phone:
                if payload.target == "material" and not existing.contact_phone:
                    existing.contact_phone = place.phone
                elif payload.target == "water" and not existing.phone:
                    existing.phone = place.phone
            result.updated += 1
            result.updated_items.append(ParserResultItem(id=place.twogis_id, name=place.name))
            continue

        other_kind_match = await db.scalar(select(other_model.id).where(other_model.twogis_id == place.twogis_id))
        if other_kind_match is not None:
            result.cross_target_conflicts += 1
            result.skipped += 1
            result.skipped_items.append(ParserSkippedItem(name=place.name, reason="Уже существует в другом типе точки"))
            continue

        if payload.target == "material":
            point = Quarry(
                name=place.name,
                short_name=place.name,
                point_type=point_type,
                address=place.address,
                contact_phone=place.phone,
                lat=place.lat,
                lon=place.lon,
                is_active=False,
                moderation_status="incomplete",
                twogis_id=place.twogis_id,
                crm_status=CrmStatus.auto_added.value,
                parsed_data=place.parsed_data,
            )
        else:
            point = WaterPoint(
                water_type="unknown",
                name=place.name,
                source="2GIS",
                address=place.address,
                lat=place.lat,
                lon=place.lon,
                phone=place.phone,
                is_active=False,
                moderation_status="pending_moderation",
                twogis_id=place.twogis_id,
                crm_status=CrmStatus.auto_added.value,
                parsed_data=place.parsed_data,
            )
        db.add(point)
        await db.flush()
        db.add(
            PointAuditLog(
                point_id=point.id,
                point_kind=point_kind,
                admin_id=admin_id,
                old_status=None,
                new_status=CrmStatus.auto_added.value,
            )
        )
        result.created += 1
        result.created_items.append(ParserResultItem(id=place.twogis_id, name=place.name))

    return result
