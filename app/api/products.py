from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import Product
from app.schemas.product import ProductResponse

router = APIRouter()


@router.get("/", response_model=list[ProductResponse])
async def list_products(
    db: AsyncSession = Depends(get_db),
) -> list[Product]:
    result = await db.execute(select(Product).order_by(Product.name.asc()))
    return list(result.scalars().all())
