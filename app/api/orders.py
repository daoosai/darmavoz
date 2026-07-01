from datetime import date as date_type
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import Client, Driver, Order, User
from app.schemas.order import CheckoutRequest, DriverCancelOrderRequest, ManualOrderAssignIn, OrderDeleteOut, OrderOut
from app.security.auth import get_current_approved_driver, get_current_logist_user, get_current_user, get_optional_current_client
from app.services.dispatch_service import (
    assign_order_to_driver_manually,
    cancel_driver_assigned_order,
    build_manual_assign_push_message,
    create_checkout_order,
    delete_order_by_id,
    get_order_by_id,
    list_recent_orders,
)
from app.services.push_service import send_push_to_driver

router = APIRouter()


@router.get("/", response_model=list[OrderOut])
async def list_orders(
    show_deleted: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Order]:
    del current_user
    return await list_recent_orders(db, show_deleted=show_deleted)


@router.get("/admin", response_model=list[OrderOut])
async def list_admin_orders(
    driver_id: UUID | None = None,
    date: date_type | None = None,
    show_deleted: bool = False,
    current_user: User = Depends(get_current_logist_user),
    db: AsyncSession = Depends(get_db),
) -> list[Order]:
    del current_user
    return await list_recent_orders(db, driver_id=driver_id, created_on=date, show_deleted=show_deleted)


@router.delete("/{order_id}", response_model=OrderDeleteOut)
async def delete_order(
    order_id: UUID,
    current_user: User = Depends(get_current_logist_user),
    session: AsyncSession = Depends(get_db),
) -> OrderDeleteOut:
    del current_user
    await delete_order_by_id(session, order_id)
    return OrderDeleteOut(ok=True, message="Заказ перемещен в архив")


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
    push_title, push_body = build_manual_assign_push_message(order)
    background_tasks.add_task(
        send_push_to_driver,
        payload.driver_id,
        push_title,
        push_body,
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
        delivery_address=payload.delivery_address,
        notes=payload.notes,
        source=payload.source,
        quantity=payload.quantity,
        address_id=payload.address_id,
        quarry_id=payload.quarry_id,
        delivery_lat=payload.delivery_lat,
        delivery_lon=payload.delivery_lon,
        mileage_km=payload.mileage_km,
    )


@router.patch("/{order_id}/driver-cancel", response_model=OrderOut)
async def driver_cancel_order(
    order_id: UUID,
    payload: DriverCancelOrderRequest,
    db: AsyncSession = Depends(get_db),
    current_driver: Driver = Depends(get_current_approved_driver),
) -> Order:
    return await cancel_driver_assigned_order(
        db,
        order_id=order_id,
        driver_id=current_driver.id,
        reason=payload.reason,
    )


@router.get("/{order_id}", response_model=OrderOut)
async def get_order(
    order_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Order:
    del current_user
    return await get_order_by_id(db, order_id)
