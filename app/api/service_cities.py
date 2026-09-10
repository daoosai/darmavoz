from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import City, Driver, Quarry, WaterPoint, SepticProviderProfile, SpecialEquipmentListing, User, driver_cities, user_cities
from app.security.auth import get_current_user, get_current_admin_user

router = APIRouter()


class ServiceCitiesIn(BaseModel):
    city_ids: list[UUID] = Field(min_length=1)

    @field_validator('city_ids')
    @classmethod
    def unique_cities(cls, values):
        if len(values) != len(set(values)):
            raise ValueError('Повторные города не допускаются')
        return values


async def get_service_cities(db: AsyncSession, user: User):
    driver = await db.scalar(select(Driver).where(Driver.user_id == user.id))
    table, owner = (driver_cities, driver.id) if driver else (user_cities, user.id)
    column = table.c.driver_id if driver else table.c.user_id
    return {'city_ids': list((await db.scalars(select(table.c.city_id).where(column == owner))).all())}


async def set_service_cities(db: AsyncSession, user: User, payload: ServiceCitiesIn, *, admin: bool = False):
    # Owner lock coordinates profile edits with point creation/update.
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())
    cities = list((await db.scalars(select(City).where(City.id.in_(payload.city_ids)))).all())
    if len(cities) != len(payload.city_ids) or (not admin and any(not city.is_active for city in cities)):
        raise HTTPException(409, 'Выберите доступные города')
    driver = await db.scalar(select(Driver).where(Driver.user_id == user.id))
    table, owner = (driver_cities, driver.id) if driver else (user_cities, user.id)
    column = table.c.driver_id if driver else table.c.user_id
    if not driver:
        for model in (Quarry, WaterPoint, SepticProviderProfile, SpecialEquipmentListing):
            if await db.scalar(select(model.id).where(model.owner_user_id == user.id, model.city_id.not_in(payload.city_ids)).limit(1)):
                raise HTTPException(409, 'Сначала измените город обслуживаемых объектов')
    await db.execute(delete(table).where(column == owner, table.c.city_id.not_in(payload.city_ids)))
    for city_id in payload.city_ids:
        await db.execute(insert(table).values({column.name: owner, 'city_id': city_id}).on_conflict_do_nothing())
    await db.commit()
    return await get_service_cities(db, user)


@router.get('/profile/cities')
async def my_cities(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return await get_service_cities(db, user)


@router.patch('/profile/cities')
async def update_my_cities(payload: ServiceCitiesIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role.name not in {'driver', 'supplier', 'equipment_owner', 'water_septic_partner'}:
        raise HTTPException(403, 'Требуется профиль исполнителя')
    return await set_service_cities(db, user, payload)


@router.get('/admin/users/{user_id}/cities', dependencies=[Depends(get_current_admin_user)])
async def admin_user_cities(user_id: UUID, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(404, 'Пользователь не найден')
    return await get_service_cities(db, user)


@router.patch('/admin/users/{user_id}/cities', dependencies=[Depends(get_current_admin_user)])
async def update_admin_user_cities(user_id: UUID, payload: ServiceCitiesIn, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(404, 'Пользователь не найден')
    return await set_service_cities(db, user, payload, admin=True)


@router.get('/admin/drivers/{driver_id}/cities', dependencies=[Depends(get_current_admin_user)])
async def admin_driver_cities(driver_id: UUID, db: AsyncSession = Depends(get_db)):
    if await db.get(Driver, driver_id) is None:
        raise HTTPException(404, 'Водитель не найден')
    return {'city_ids': list((await db.scalars(select(driver_cities.c.city_id).where(driver_cities.c.driver_id == driver_id))).all())}


@router.patch('/admin/drivers/{driver_id}/cities', dependencies=[Depends(get_current_admin_user)])
async def update_admin_driver_cities(driver_id: UUID, payload: ServiceCitiesIn, db: AsyncSession = Depends(get_db)):
    driver = await db.scalar(select(Driver).where(Driver.id == driver_id).with_for_update())
    if driver is None:
        raise HTTPException(404, 'Водитель не найден')
    if driver.user_id:
        user = await db.get(User, driver.user_id)
        return await set_service_cities(db, user, payload, admin=True)
    cities = list((await db.scalars(select(City.id).where(City.id.in_(payload.city_ids)))).all())
    if len(cities) != len(payload.city_ids):
        raise HTTPException(409, 'Выберите существующие города')
    await db.execute(delete(driver_cities).where(driver_cities.c.driver_id == driver.id, driver_cities.c.city_id.not_in(payload.city_ids)))
    for city_id in payload.city_ids:
        await db.execute(insert(driver_cities).values(driver_id=driver.id, city_id=city_id).on_conflict_do_nothing())
    await db.commit()
    return {'city_ids': payload.city_ids}
