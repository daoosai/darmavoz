from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import exists, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import DeliveryOption, DeliveryTariff, Order, TransportCategory, User
from app.schemas.catalog import DeliveryOptionOut
from app.schemas.transport import (
    DeliveryTariffCreate,
    DeliveryTariffOut,
    DeliveryTariffUpdate,
    TransportCategoryCreate,
    TransportCategoryOut,
    TransportCategoryUpdate,
)
from app.security.auth import get_current_admin_user


router = APIRouter()
admin_router = APIRouter()


def _active_tariff_exists(city_id: UUID):
    return exists(
        select(DeliveryTariff.id).where(
            DeliveryTariff.city_id == city_id,
            DeliveryTariff.transport_category_id == TransportCategory.id,
            DeliveryTariff.is_active.is_(True),
        )
    )


async def _validate_tariff_range(
    db: AsyncSession,
    *,
    city_id: UUID,
    category_id: UUID,
    distance_from_km: float,
    distance_to_km: float | None,
    exclude_id: UUID | None = None,
) -> None:
    query = select(DeliveryTariff.id).where(
        DeliveryTariff.city_id == city_id,
        DeliveryTariff.transport_category_id == category_id,
        DeliveryTariff.distance_from_km < (distance_to_km if distance_to_km is not None else float("inf")),
        (DeliveryTariff.distance_to_km.is_(None)) | (DeliveryTariff.distance_to_km > distance_from_km),
    )
    if exclude_id is not None:
        query = query.where(DeliveryTariff.id != exclude_id)
    if await db.scalar(query.limit(1)) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Диапазоны тарифов пересекаются с существующим диапазоном для этого города и категории.",
        )


@router.get("/transport-categories", response_model=list[TransportCategoryOut])
async def list_public_transport_categories(
    city_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(TransportCategory).where(TransportCategory.is_active.is_(True))
    if city_id is not None:
        query = query.where(_active_tariff_exists(city_id))
    return list((await db.scalars(query.order_by(TransportCategory.sort_order, TransportCategory.title))).all())


@router.get("/transport-categories/{category_id}/delivery-options", response_model=list[DeliveryOptionOut])
async def list_public_capacity_options(
    category_id: UUID,
    city_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    category = await db.get(TransportCategory, category_id)
    tariff_exists = await db.scalar(
        select(DeliveryTariff.id).where(
            DeliveryTariff.city_id == city_id,
            DeliveryTariff.transport_category_id == category_id,
            DeliveryTariff.is_active.is_(True),
        ).limit(1)
    )
    if category is None or not category.is_active or tariff_exists is None:
        raise HTTPException(status_code=404, detail="Категория транспорта недоступна в выбранном городе.")
    return list(
        (
            await db.scalars(
                select(DeliveryOption)
                .where(
                    DeliveryOption.transport_category_id == category_id,
                    DeliveryOption.is_active.is_(True),
                )
                .order_by(DeliveryOption.capacity_m3, DeliveryOption.sort_order)
            )
        ).all()
    )


@admin_router.get("/transport-categories", response_model=list[TransportCategoryOut])
async def list_transport_categories(
    db: AsyncSession = Depends(get_db), current_admin: User = Depends(get_current_admin_user)
):
    del current_admin
    return list((await db.scalars(select(TransportCategory).order_by(TransportCategory.sort_order, TransportCategory.title))).all())


@admin_router.post("/transport-categories", response_model=TransportCategoryOut, status_code=status.HTTP_201_CREATED)
async def create_transport_category(
    payload: TransportCategoryCreate,
    db: AsyncSession = Depends(get_db), current_admin: User = Depends(get_current_admin_user)
):
    del current_admin
    category = TransportCategory(**payload.model_dump())
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return category


@admin_router.patch("/transport-categories/{category_id}", response_model=TransportCategoryOut)
async def update_transport_category(
    category_id: UUID,
    payload: TransportCategoryUpdate,
    db: AsyncSession = Depends(get_db), current_admin: User = Depends(get_current_admin_user)
):
    del current_admin
    category = await db.get(TransportCategory, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="Категория транспорта не найдена.")
    values = payload.model_dump(exclude_unset=True)
    min_capacity = values.get("capacity_min_m3", category.capacity_min_m3)
    max_capacity = values.get("capacity_max_m3", category.capacity_max_m3)
    if max_capacity is not None and max_capacity < min_capacity:
        raise HTTPException(status_code=422, detail="Максимальная вместимость меньше минимальной.")
    for field, value in values.items():
        setattr(category, field, value)
    await db.commit()
    await db.refresh(category)
    return category


@admin_router.delete("/transport-categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transport_category(
    category_id: UUID,
    db: AsyncSession = Depends(get_db), current_admin: User = Depends(get_current_admin_user)
):
    del current_admin
    category = await db.get(TransportCategory, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="Категория транспорта не найдена.")
    has_delivery_options = await db.scalar(
        select(DeliveryOption.id)
        .where(DeliveryOption.transport_category_id == category_id)
        .limit(1)
    )
    has_tariffs = await db.scalar(
        select(DeliveryTariff.id)
        .where(DeliveryTariff.transport_category_id == category_id)
        .limit(1)
    )
    if has_delivery_options is not None or has_tariffs is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Нельзя удалить категорию с привязанными типами машин или тарифами.",
        )
    await db.delete(category)
    await db.commit()


@admin_router.get("/transport-categories/{category_id}/tariffs", response_model=list[DeliveryTariffOut])
async def list_category_tariffs(
    category_id: UUID,
    city_id: UUID | None = None,
    db: AsyncSession = Depends(get_db), current_admin: User = Depends(get_current_admin_user)
):
    del current_admin
    query = select(DeliveryTariff).where(DeliveryTariff.transport_category_id == category_id)
    if city_id is not None:
        query = query.where(DeliveryTariff.city_id == city_id)
    return list((await db.scalars(query.order_by(DeliveryTariff.city_id, DeliveryTariff.distance_from_km))).all())


@admin_router.post("/transport-categories/{category_id}/tariffs", response_model=DeliveryTariffOut, status_code=status.HTTP_201_CREATED)
async def create_category_tariff(
    category_id: UUID,
    payload: DeliveryTariffCreate,
    db: AsyncSession = Depends(get_db), current_admin: User = Depends(get_current_admin_user)
):
    del current_admin
    if await db.get(TransportCategory, category_id) is None:
        raise HTTPException(status_code=404, detail="Категория транспорта не найдена.")
    await _validate_tariff_range(
        db, city_id=payload.city_id, category_id=category_id,
        distance_from_km=payload.distance_from_km, distance_to_km=payload.distance_to_km,
    )
    tariff = DeliveryTariff(transport_category_id=category_id, **payload.model_dump())
    db.add(tariff)
    await db.commit()
    await db.refresh(tariff)
    return tariff


@admin_router.delete("/transport-tariffs/{tariff_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category_tariff(
    tariff_id: UUID,
    db: AsyncSession = Depends(get_db), current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    tariff = await db.get(DeliveryTariff, tariff_id)
    if tariff is None:
        raise HTTPException(status_code=404, detail="Тариф не найден.")

    await db.execute(
        update(Order)
        .where(Order.delivery_tariff_id == tariff_id)
        .values(delivery_tariff_id=None)
    )
    await db.delete(tariff)
    await db.commit()


@admin_router.patch("/transport-tariffs/{tariff_id}", response_model=DeliveryTariffOut)
async def update_category_tariff(
    tariff_id: UUID,
    payload: DeliveryTariffUpdate,
    db: AsyncSession = Depends(get_db), current_admin: User = Depends(get_current_admin_user)
):
    del current_admin
    tariff = await db.get(DeliveryTariff, tariff_id)
    if tariff is None:
        raise HTTPException(status_code=404, detail="Тариф не найден.")
    values = payload.model_dump(exclude_unset=True)
    distance_from = values.get("distance_from_km", tariff.distance_from_km)
    distance_to = values.get("distance_to_km", tariff.distance_to_km)
    if distance_to is not None and distance_to <= distance_from:
        raise HTTPException(status_code=422, detail="Конец диапазона должен быть больше начала.")
    await _validate_tariff_range(
        db, city_id=tariff.city_id, category_id=tariff.transport_category_id,
        distance_from_km=distance_from, distance_to_km=distance_to, exclude_id=tariff.id,
    )
    for field, value in values.items():
        setattr(tariff, field, value)
    await db.commit()
    await db.refresh(tariff)
    return tariff
