from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.database import get_db
from app.models.models import Driver, User, Vehicle
from app.schemas.driver import DriverCreate, DriverResponse
from app.security.auth import get_current_logist_user

router = APIRouter()


def build_driver_list_query(
    *,
    delivery_option_id: UUID | None = None,
    status_filter: str | None = None,
) -> Select[tuple[Driver]]:
    stmt = (
        select(Driver)
        .join(Driver.user)
        .where(User.is_active.is_(True))
        .options(selectinload(Driver.vehicle).selectinload(Vehicle.delivery_option))
        .order_by(Driver.name.asc())
    )

    if status_filter:
        stmt = stmt.where(Driver.status == status_filter)
    if delivery_option_id:
        stmt = stmt.join(Driver.vehicle).where(Vehicle.delivery_option_id == delivery_option_id)

    return stmt


async def fetch_drivers(
    db: AsyncSession,
    *,
    delivery_option_id: UUID | None = None,
    status_filter: str | None = None,
) -> list[Driver]:
    result = await db.execute(
        build_driver_list_query(
            delivery_option_id=delivery_option_id,
            status_filter=status_filter,
        )
    )
    return list(result.scalars().all())


@router.post("/", response_model=DriverResponse, status_code=status.HTTP_201_CREATED)
async def create_driver(
    payload: DriverCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    del current_user
    existing = await db.execute(select(Driver).where(Driver.phone == payload.phone))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Driver with this phone already exists",
        )

    if payload.vehicle_id is not None:
        vehicle = await db.get(Vehicle, payload.vehicle_id)
        if vehicle is None:
            raise HTTPException(status_code=404, detail="Vehicle not found")

    driver = Driver(
        name=payload.name,
        phone=payload.phone,
        status=payload.status or "offline",
        vehicle_id=payload.vehicle_id,
        is_auto_dispatch_enabled=payload.is_auto_dispatch_enabled,
        dispatch_priority=payload.dispatch_priority,
    )
    db.add(driver)
    await db.commit()
    result = await db.execute(
        select(Driver)
        .options(selectinload(Driver.vehicle).selectinload(Vehicle.delivery_option))
        .where(Driver.id == driver.id)
    )
    return result.scalar_one()


@router.get("/", response_model=List[DriverResponse])
async def list_drivers(
    delivery_option_id: UUID | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    del current_user
    return await fetch_drivers(
        db,
        delivery_option_id=delivery_option_id,
        status_filter=status_filter,
    )
