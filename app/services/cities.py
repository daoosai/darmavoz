from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select, false
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import City, Driver, User, driver_cities, user_cities
from sqlalchemy.dialects.postgresql import insert

LEGACY_CITY_CODE = "tyumen"


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


async def ensure_owner_city(db: AsyncSession, owner_id: UUID | None, city_id: UUID):
    if owner_id is not None:
        await db.execute(select(User.id).where(User.id == owner_id).with_for_update())
    if owner_id is not None and not await db.scalar(select(user_cities.c.user_id).where(
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
