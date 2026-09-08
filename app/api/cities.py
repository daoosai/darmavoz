from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError
from sqlalchemy import select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import City
from app.schemas.city import CityCreate, CityOut, CityUpdate
from app.security.auth import get_current_admin_user, get_current_logist_user
from app.services.cities import LEGACY_CITY_CODE

router = APIRouter()
admin_router = APIRouter(dependencies=[Depends(get_current_admin_user)])


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


@admin_router.post("/cities/", response_model=CityOut, status_code=201)
async def create_city(payload: CityCreate, db: AsyncSession = Depends(get_db)):
    city = City(**payload.model_dump(), is_active=False, is_default=False)
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
