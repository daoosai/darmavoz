from math import asin, cos, isfinite, radians, sin, sqrt
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import false, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import City, DeliveryTariff, Driver, Material, Quarry, User, quarry_materials, driver_cities, user_cities
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


def city_distance_km(lat: float, lon: float, city: City) -> float:
    a = sin(radians(city.center_lat - lat) / 2) ** 2 + cos(radians(lat)) * cos(radians(city.center_lat)) * sin(radians(city.center_lon - lon) / 2) ** 2
    return 12742 * asin(sqrt(min(1.0, a)))


async def resolve_delivery_city(db: AsyncSession, city_id: UUID | None, lat: float | None, lon: float | None) -> City:
    """Resolve parser-discovered suburbs to a nearby configured delivery market.

    Existing markets (including ones with disabled tariffs) retain their scope.
    City bounds are search bounds, not a hard boundary for suburban delivery.
    """
    city = await resolve_city(db, city_id)
    configured = await db.scalar(select(DeliveryTariff.id).where(DeliveryTariff.city_id == city.id).limit(1))
    inventory = await db.scalar(select(Quarry.id).join(quarry_materials, quarry_materials.c.quarry_id == Quarry.id).join(
        Material, Material.id == quarry_materials.c.material_id,
    ).where(
        Quarry.city_id == city.id, quarry_materials.c.is_active.is_(True), Material.is_active.is_(True),
        (quarry_materials.c.price > 0) | Material.is_free.is_(True),
    ).limit(1))
    if city.code == LEGACY_CITY_CODE or configured is not None or inventory is not None:
        return city
    if lat is None or lon is None or not isfinite(lat) or not isfinite(lon) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return city
    if city_distance_km(lat, lon, city) > 100:
        return city
    candidates = list((await db.scalars(select(City).where(
        City.is_active.is_(True),
        (City.code == LEGACY_CITY_CODE) | City.id.in_(select(DeliveryTariff.city_id).where(DeliveryTariff.is_active.is_(True))),
    ))).all())
    nearby = sorted((city_distance_km(lat, lon, candidate), str(candidate.id), candidate) for candidate in candidates)
    return nearby[0][2] if nearby and nearby[0][0] <= 100 else city
