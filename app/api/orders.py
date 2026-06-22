from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import Client, Order, User
from app.schemas.order import CheckoutRequest, ManualOrderAssignIn, OrderDeleteOut, OrderOut
from app.security.auth import get_current_logist_user, get_current_user, get_optional_current_client
from app.services.dispatch_service import (
    NEW_ORDER_PUSH_BODY,
    NEW_ORDER_PUSH_TITLE,
    assign_order_to_driver_manually,
    create_checkout_order,
    delete_order_by_id,
    get_order_by_id,
    list_recent_orders,
)
from app.services.push_service import send_push_to_driver

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


@router.delete("/{order_id}", response_model=OrderDeleteOut)
async def delete_order(
    order_id: UUID,
    current_user: User = Depends(get_current_logist_user),
    session: AsyncSession = Depends(get_db),
) -> OrderDeleteOut:
    del current_user
    await delete_order_by_id(session, order_id)
    return OrderDeleteOut(ok=True, message="Order deleted successfully")


@router.post("/{order_id}/assign", response_model=OrderOut)
async def assign_order(
    order_id: UUID,
    payload: ManualOrderAssignIn,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_logist_user),
    session: AsyncSession = Depends(get_db),
) -> Order:
    del current_user
    order = await assign_order_to_driver_manually(
        session,
        order_id=order_id,
        driver_id=payload.driver_id,
    )
    background_tasks.add_task(
        send_push_to_driver,
        payload.driver_id,
        NEW_ORDER_PUSH_TITLE,
        NEW_ORDER_PUSH_BODY,
    )
    return order


@router.post("/checkout", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
async def checkout_order(
    payload: CheckoutRequest,
    db: AsyncSession = Depends(get_db),
    current_client: Client | None = Depends(get_optional_current_client),
) -> Order:
    return await create_checkout_order(
        db,
        client_id=current_client.id if current_client is not None else payload.client_id,
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
