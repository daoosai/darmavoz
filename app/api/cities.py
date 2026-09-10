from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import ValidationError
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import City
from app.schemas.city import CityCreate, CityOut, CityUpdate
from app.security.auth import get_current_admin_user, get_current_logist_user
from app.services.cities import LEGACY_CITY_CODE

router = APIRouter()
admin_router = APIRouter(dependencies=[Depends(get_current_admin_user)])

CITY_REFERENCE_TABLES = (
    "client_addresses",
    "quarries",
    "water_points",
    "septic_provider_profiles",
    "special_equipment_listings",
    "special_equipment_applications",
    "orders",
    "user_cities",
    "driver_cities",
)

_TRANSLIT = str.maketrans({
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z", "и": "i", "й": "y",
    "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f",
    "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
})


def city_code_base(name: str) -> str:
    transliterated = name.lower().translate(_TRANSLIT)
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


@router.get("/cities/", response_model=list[CityOut])
async def list_cities(db: AsyncSession = Depends(get_db)):
    return list((await db.scalars(select(City).where(City.is_active.is_(True)).order_by(City.sort_order, City.name))).all())


@admin_router.get("/cities/", response_model=list[CityOut])
async def list_admin_cities(db: AsyncSession = Depends(get_db)):
    return list((await db.scalars(select(City).order_by(City.sort_order, City.name))).all())


@router.get("/operator/cities/", response_model=list[CityOut], dependencies=[Depends(get_current_logist_user)])
async def list_operator_cities(db: AsyncSession = Depends(get_db)):
    return list((await db.scalars(select(City).order_by(City.sort_order, City.name))).all())


async def save_city(db: AsyncSession, city: City):
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "Код города уже используется или настройки конфликтуют") from exc
    await db.refresh(city)
    return city


async def city_has_references(db: AsyncSession, city_id: UUID) -> bool:
    for table_name in CITY_REFERENCE_TABLES:
        table = City.metadata.tables[table_name]
        reference = await db.scalar(
            select(table.c.city_id).where(table.c.city_id == city_id).limit(1)
        )
        if reference is not None:
            return True
    return False


@admin_router.post("/cities/", response_model=CityOut, status_code=201)
async def create_city(payload: CityCreate, db: AsyncSession = Depends(get_db)):
    # The lock prevents two simultaneous admin requests from passing the name
    # check before either transaction commits.
    await db.execute(text("SELECT pg_advisory_xact_lock(220023)"))
    existing_city_id = await db.scalar(
        select(City.id).where(func.lower(City.name) == payload.name.lower())
    )
    if existing_city_id is not None:
        raise HTTPException(400, "Этот город уже добавлен")
    values = payload.model_dump()
    values["code"] = values["code"] or await generated_city_code(db, payload.name)
    if values["min_lat"] is None:
        values.update(default_bounds(payload.center_lat, payload.center_lon))
    city = City(**values, is_active=False, is_default=False)
    db.add(city)
    return await save_city(db, city)


@admin_router.patch("/cities/{city_id}", response_model=CityOut)
async def update_city(city_id: UUID, payload: CityUpdate, db: AsyncSession = Depends(get_db)):
    # Serialize publication/default changes, including simultaneous admin requests.
    await db.execute(text("SELECT pg_advisory_xact_lock(220022)"))
    cities = list((await db.scalars(select(City).with_for_update())).all())
    city = next((item for item in cities if item.id == city_id), None)
    if city is None:
        raise HTTPException(404, "Город не найден")
    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes and any(
        item.id != city.id and item.name.casefold() == changes["name"].casefold()
        for item in cities
    ):
        raise HTTPException(400, "Этот город уже добавлен")
    if city.code == LEGACY_CITY_CODE and changes.get("code", city.code) != city.code:
        raise HTTPException(409, "Код исходного города используется старыми клиентами")
    merged = {**CityOut.model_validate(city).model_dump(), **changes}
    try:
        validated = CityCreate.model_validate({key: merged[key] for key in CityCreate.model_fields})
    except ValidationError as exc:
        raise HTTPException(422, "Проверьте название и географические параметры города") from exc
    active, default = merged["is_active"], merged["is_default"]
    if not active and (city.is_default or default):
        raise HTTPException(409, "Сначала выберите другой город по умолчанию")
    if not active and not any(item.is_active and item.id != city.id for item in cities):
        raise HTTPException(409, "Нельзя отключить последний активный город")
    if city.is_default and not default:
        raise HTTPException(409, "Назначьте другой город по умолчанию")
    if default and not city.is_default:
        await db.execute(update(City).where(City.is_default.is_(True)).values(is_default=False))
    for key, value in validated.model_dump().items():
        setattr(city, key, value)
    city.is_active, city.is_default = active, default
    return await save_city(db, city)


@admin_router.delete("/cities/{city_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_city(city_id: UUID, db: AsyncSession = Depends(get_db)):
    await db.execute(text("SELECT pg_advisory_xact_lock(220022)"))
    cities = list((await db.scalars(select(City).with_for_update())).all())
    city = next((item for item in cities if item.id == city_id), None)
    if city is None:
        raise HTTPException(404, "Город не найден")
    if city.is_default:
        raise HTTPException(409, "Сначала назначьте другой город по умолчанию")
    if city.is_active and not any(item.is_active and item.id != city.id for item in cities):
        raise HTTPException(409, "Нельзя удалить последний активный город")
    if await city_has_references(db, city_id):
        raise HTTPException(
            409,
            "Нельзя удалить город, пока к нему привязаны точки, заказы или пользователи",
        )
    await db.delete(city)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            409,
            "Нельзя удалить город, пока к нему привязаны точки, заказы или пользователи",
        ) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
