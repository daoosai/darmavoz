from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import false, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import City, Driver, User, driver_cities, user_cities
from sqlalchemy.dialects.postgresql import insert

LEGACY_CITY_CODE = "tyumen"

_CITY_TRANSLIT = str.maketrans({
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z", "и": "i", "й": "y",
    "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f",
    "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
})


def city_code_base(name: str) -> str:
    transliterated = name.lower().translate(_CITY_TRANSLIT)
    parts = "".join(char if char.isascii() and char.isalnum() else "-" for char in transliterated).split("-")
    return "-".join(part for part in parts if part)[:64] or "city"


async def generated_city_code(db: AsyncSession, name: str) -> str:
    base = city_code_base(name)
    candidate, number = base, 2
    while await db.scalar(select(City.id).where(City.code == candidate)) is not None:
        suffix = f"-{number}"
        candidate = f"{base[:64 - len(suffix)]}{suffix}"
        number += 1
    return candidate


def default_bounds(center_lat: float, center_lon: float) -> dict[str, float]:
    radius = 0.5
    return {
        "min_lat": max(-90, center_lat - radius), "max_lat": min(90, center_lat + radius),
        "min_lon": max(-180, center_lon - radius), "max_lon": min(180, center_lon + radius),
    }


async def get_or_create_parsed_city(
    db: AsyncSession,
    *,
    name: str,
    region: str | None,
    center_lat: float,
    center_lon: float,
) -> City:
    """Return a case-insensitive city match or create an active parser-discovered city."""
    normalized_name = " ".join(name.split())
    if not normalized_name:
        raise ValueError("Parser city name must not be blank")

    # The same transaction lock is used by manual city creation, so parallel parser
    # imports cannot create case-insensitive duplicates.
    await db.execute(text("SELECT pg_advisory_xact_lock(220023)"))
    existing = await db.scalar(
        select(City).where(func.lower(City.name) == normalized_name.lower())
    )
    if existing is not None:
        return existing

    city = City(
        name=normalized_name,
        region=" ".join((region or normalized_name).split()),
        code=await generated_city_code(db, normalized_name),
        center_lat=center_lat,
        center_lon=center_lon,
        map_zoom=11,
        **default_bounds(center_lat, center_lon),
        is_active=True,
        is_default=False,
    )
    db.add(city)
    await db.flush()
    return city


async def resolve_city(db: AsyncSession, city_id: UUID | None, *, require_active: bool = True) -> City:
    """Omitted city always means the original market, never the admin default."""
    city = await db.scalar(select(City).where(
        City.id == city_id if city_id is not None else City.code == LEGACY_CITY_CODE
    ))
    if city is None or (require_active and not city.is_active):
        raise HTTPException(409, "Город недоступен. Выберите активный город")
    return city


def ensure_same_city(city_id: UUID, obj) -> None:
    if obj is None or obj.city_id != city_id:
        raise HTTPException(409, "Объект относится к другому городу или требует проверки города")


def driver_city_clause(city_id: UUID | None):
    if city_id is None:
        return false()
    return Driver.id.in_(select(driver_cities.c.driver_id).where(driver_cities.c.city_id == city_id))


async def ensure_driver_city(db: AsyncSession, order, driver_id: UUID):
    if order.city_id is None or not await db.scalar(select(driver_cities.c.driver_id).where(
        driver_cities.c.driver_id == driver_id, driver_cities.c.city_id == order.city_id,
    )):
        raise HTTPException(409, "Водитель не обслуживает город заказа")


async def ensure_owner_city(
    db: AsyncSession,
    owner_id: UUID | None,
    city_id: UUID,
    *,
    auto_sync: bool = False,
):
    if owner_id is None:
        return

    await db.execute(select(User.id).where(User.id == owner_id).with_for_update())
    if auto_sync:
        await db.execute(
            insert(user_cities)
            .values(user_id=owner_id, city_id=city_id)
            .on_conflict_do_nothing()
        )
        return

    if not await db.scalar(select(user_cities.c.user_id).where(
        user_cities.c.user_id == owner_id, user_cities.c.city_id == city_id,
    )):
        raise HTTPException(409, "Город точки должен входить в города обслуживания владельца")


async def initialize_service_cities(db: AsyncSession, *, user_id: UUID | None = None, driver_id: UUID | None = None, city_ids: list[UUID] | None = None, require_active: bool = True):
    if city_ids is not None:
        city_ids = [UUID(str(value)) for value in city_ids]
    if city_ids is not None and (not city_ids or len(set(city_ids)) != len(city_ids)):
        raise HTTPException(422, "Выберите города без повторений")
    ids = city_ids if city_ids is not None else [(await resolve_city(db, None)).id]
    for city_id in ids:
        await resolve_city(db, city_id, require_active=require_active)
        if user_id is not None:
            await db.execute(insert(user_cities).values(user_id=user_id, city_id=city_id).on_conflict_do_nothing())
        if driver_id is not None:
            await db.execute(insert(driver_cities).values(driver_id=driver_id, city_id=city_id).on_conflict_do_nothing())
