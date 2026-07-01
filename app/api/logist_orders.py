from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import Order, User
from app.schemas.order import DispatchHistoryOut, LogistOrderCreate, OrderDeleteOut, OrderOut
from app.security.auth import get_current_logist_user
from app.services.dispatch_service import (
    build_dispatch_history,
    create_logist_order,
    delete_order_by_id,
    get_order_by_id,
    restart_dispatch_for_order,
)

router = APIRouter()


@router.post("/orders", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
async def create_order_by_logist(
    payload: LogistOrderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> Order:
    del current_user
    return await create_logist_order(db, payload)


@router.get("/orders/{order_id}", response_model=OrderOut)
async def get_logist_order(
    order_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> Order:
    del current_user
    return await get_order_by_id(db, order_id)


@router.delete("/orders/{order_id}", response_model=OrderDeleteOut)
async def delete_logist_order(
    order_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> OrderDeleteOut:
    del current_user
    await delete_order_by_id(db, order_id)
    return OrderDeleteOut(ok=True, message="Заказ перемещен в архив")


@router.get("/orders/{order_id}/dispatch-history", response_model=DispatchHistoryOut)
async def get_dispatch_history(
    order_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> DispatchHistoryOut:
    del current_user
    return await build_dispatch_history(db, order_id)


@router.post("/orders/{order_id}/redispatch", response_model=OrderOut)
async def redispatch_order(
    order_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> Order:
    del current_user
    return await restart_dispatch_for_order(db, order_id)
