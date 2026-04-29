from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.database import get_db
from app.models.models import Order, User
from app.schemas.order import OrderDemoResponse
from app.security.auth import get_current_user

router = APIRouter()


@router.get("/", response_model=list[OrderDemoResponse])
async def list_orders(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Order]:
    stmt = (
        select(Order)
        .options(selectinload(Order.client))
        .order_by(Order.created_at.desc())
        .limit(10)
    )
    result = await db.execute(stmt)
    orders = result.scalars().all()
    return list(orders)
