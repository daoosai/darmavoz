from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import Order, User
from app.schemas.order import CheckoutRequest, OrderOut
from app.security.auth import get_current_logist_user, get_current_user
from app.services.dispatch_service import create_checkout_order, get_order_by_id, list_recent_orders

router = APIRouter()


@router.get("/", response_model=list[OrderOut])
async def list_orders(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Order]:
    del current_user
    return await list_recent_orders(db)


@router.get("/admin", response_model=list[OrderOut])
async def list_admin_orders(
    current_user: User = Depends(get_current_logist_user),
    db: AsyncSession = Depends(get_db),
) -> list[Order]:
    del current_user
    return await list_recent_orders(db)


@router.delete("/{order_id}")
async def delete_order(
    order_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> dict[str, str | bool]:
    del current_user
    order = await session.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")

    await session.delete(order)
    await session.commit()
    return {"ok": True, "message": "Order deleted successfully"}


@router.post("/checkout", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
async def checkout_order(payload: CheckoutRequest, db: AsyncSession = Depends(get_db)) -> Order:
    return await create_checkout_order(
        db,
        client_id=payload.client_id,
        material_id=payload.material_id,
        delivery_option_id=payload.delivery_option_id,
        address=payload.address,
        notes=payload.notes,
        source=payload.source,
        quantity=payload.quantity,
    )


@router.get("/{order_id}", response_model=OrderOut)
async def get_order(
    order_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Order:
    del current_user
    return await get_order_by_id(db, order_id)
