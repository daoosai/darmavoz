from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.database import get_db
from app.models.models import Material, Order, Quarry
from app.schemas.quarry import QuarryCreate, QuarryOut, QuarryUpdate
from app.security.auth import get_current_admin_user
from app.api.admin import DeleteResult

router = APIRouter()


async def _load_materials(db: AsyncSession, material_ids: list[UUID]) -> list[Material]:
    normalized_ids = list(dict.fromkeys(material_ids))
    if not normalized_ids:
        return []

    result = await db.execute(
        select(Material)
        .where(Material.id.in_(normalized_ids))
        .order_by(Material.name.asc())
    )
    materials = list(result.scalars().all())
    if len(materials) != len(normalized_ids):
        raise HTTPException(status_code=404, detail="One or more materials not found")
    return materials


async def _get_quarry_or_404(db: AsyncSession, quarry_id: UUID) -> Quarry:
    result = await db.execute(
        select(Quarry)
        .options(selectinload(Quarry.materials))
        .where(Quarry.id == quarry_id)
    )
    quarry = result.scalar_one_or_none()
    if quarry is None:
        raise HTTPException(status_code=404, detail="Quarry not found")
    quarry.material_ids = [material.id for material in quarry.materials]
    return quarry


@router.get("/quarries", response_model=list[QuarryOut])
async def list_quarries(
    db: AsyncSession = Depends(get_db),
    current_admin=Depends(get_current_admin_user),
) -> list[Quarry]:
    del current_admin
    result = await db.execute(
        select(Quarry)
        .options(selectinload(Quarry.materials))
        .order_by(Quarry.name.asc())
    )
    quarries = list(result.scalars().unique().all())
    for quarry in quarries:
        quarry.material_ids = [material.id for material in quarry.materials]
    return quarries


@router.get("/quarries/{quarry_id}", response_model=QuarryOut)
async def get_quarry(
    quarry_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_admin=Depends(get_current_admin_user),
) -> Quarry:
    del current_admin
    return await _get_quarry_or_404(db, quarry_id)


@router.post("/quarries", response_model=QuarryOut, status_code=status.HTTP_201_CREATED)
async def create_quarry(
    payload: QuarryCreate,
    db: AsyncSession = Depends(get_db),
    current_admin=Depends(get_current_admin_user),
) -> Quarry:
    del current_admin
    quarry = Quarry(
        name=payload.name,
        address=payload.address,
        lat=payload.lat,
        lon=payload.lon,
        is_active=payload.is_active,
    )
    quarry.materials = await _load_materials(db, payload.material_ids)
    db.add(quarry)
    await db.commit()
    return await _get_quarry_or_404(db, quarry.id)


@router.patch("/quarries/{quarry_id}", response_model=QuarryOut)
async def update_quarry(
    quarry_id: UUID,
    payload: QuarryUpdate,
    db: AsyncSession = Depends(get_db),
    current_admin=Depends(get_current_admin_user),
) -> Quarry:
    del current_admin
    quarry = await _get_quarry_or_404(db, quarry_id)

    for field in ("name", "address", "lat", "lon", "is_active"):
        value = getattr(payload, field)
        if value is not None:
            setattr(quarry, field, value)

    if payload.material_ids is not None:
        quarry.materials = await _load_materials(db, payload.material_ids)

    await db.commit()
    return await _get_quarry_or_404(db, quarry.id)


@router.delete("/quarries/{quarry_id}", response_model=DeleteResult)
async def delete_quarry(
    quarry_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_admin=Depends(get_current_admin_user),
) -> DeleteResult:
    del current_admin
    quarry = await _get_quarry_or_404(db, quarry_id)

    linked_orders_count = await db.scalar(
        select(func.count(Order.id)).where(Order.quarry_id == quarry_id)
    )
    if linked_orders_count:
        quarry.is_active = False
        await db.commit()
        return DeleteResult(
            action="hidden",
            detail="Quarry is linked to orders and was hidden instead of deleted",
        )

    await db.delete(quarry)
    await db.commit()
    return DeleteResult(action="deleted", detail="Quarry deleted")
