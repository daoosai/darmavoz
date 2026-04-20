from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import Driver, User
from app.schemas.driver import DriverCreate, DriverResponse
from app.security.auth import get_current_logist_user

router = APIRouter()


@router.post("/", response_model=DriverResponse, status_code=status.HTTP_201_CREATED)
async def create_driver(
    payload: DriverCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    existing = await db.execute(select(Driver).where(Driver.phone == payload.phone))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Driver with this phone already exists",
        )

    driver = Driver(name=payload.name, phone=payload.phone, status=payload.status)
    db.add(driver)
    await db.commit()
    await db.refresh(driver)
    return driver


@router.get("/", response_model=List[DriverResponse])
async def list_drivers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    result = await db.execute(select(Driver).order_by(Driver.name.asc()))
    return result.scalars().all()
