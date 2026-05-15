import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import Category, Material
from app.schemas.catalog import CategoryOut, MaterialOut

router = APIRouter()


@router.get("/categories/", response_model=List[CategoryOut])
async def get_categories(db: AsyncSession = Depends(get_db)):
    """Returns a list of active categories, sorted by sort_order."""
    stmt = select(Category).where(Category.is_active == True).order_by(Category.sort_order)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/materials/", response_model=List[MaterialOut])
async def get_materials(
    category_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db)
):
    """Returns a list of active materials, sorted by sort_order, with an optional category_id filter."""
    stmt = select(Material).where(Material.is_active == True)
    if category_id:
        stmt = stmt.where(Material.category_id == category_id)
    stmt = stmt.order_by(Material.sort_order)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/materials/{id}", response_model=MaterialOut)
async def get_material(id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Returns a single material."""
    stmt = select(Material).where(Material.id == id)
    result = await db.execute(stmt)
    material = result.scalars().first()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    return material
