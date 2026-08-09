
import logging
from datetime import date as date_type
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import Order, User
from app.schemas.client import ClientFcmTokenIn, ClientFcmTokenOut
from app.schemas.order import (
    ClarificationResolveRequest,
    DispatchHistoryOut,
    LogistOrderCreate,
    OrderDeleteOut,
    OrderHistoryOut,
    OrderOut,
    OrderUpdate,
)
from app.security.auth import get_current_logist_user
from app.services.fcm_tokens import detach_fcm_token_from_other_entities
from app.services.dispatch_service import (
    build_dispatch_history,
    build_order_status_history,
    create_logist_order,
    delete_order_by_id,
    get_order_by_id,
    list_recent_orders,
    resolve_order_clarification,
    restart_dispatch_for_order,
    update_order_by_logist,
)

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/me/fcm-token", response_model=ClientFcmTokenOut)
async def save_logist_fcm_token(
    payload: ClientFcmTokenIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> ClientFcmTokenOut:
    normalized_token = payload.token.strip()
    logger.info(
        "logist_fcm_token_save_requested",
        extra={
            "user_id": str(current_user.id),
            "token_prefix": normalized_token[:24],
        },
    )
    await detach_fcm_token_from_other_entities(
        db,
        normalized_token,
        keep_user_id=current_user.id,
    )
    current_user.fcm_token = normalized_token
    await db.commit()
    return ClientFcmTokenOut(ok=True, token=current_user.fcm_token)


@router.delete("/me/fcm-token", response_model=ClientFcmTokenOut)
async def delete_logist_fcm_token(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> ClientFcmTokenOut:
    logger.info(
        "logist_fcm_token_deleted",
        extra={"user_id": str(current_user.id)},
    )
    current_user.fcm_token = None
    await db.commit()
    return ClientFcmTokenOut(ok=True, token=None)


@router.post("/orders", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
async def create_order_by_logist(
    payload: LogistOrderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> Order:
    del current_user
    return await create_logist_order(db, payload)


@router.get("/orders", response_model=list[OrderOut])
async def list_logist_orders(
    driver_id: UUID | None = None,
    date: date_type | None = None,
    is_deleted: bool = False,
    show_deleted: bool | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> list[Order]:
    del current_user
    deleted_filter = show_deleted if show_deleted is not None else is_deleted
    return await list_recent_orders(db, driver_id=driver_id, created_on=date, is_deleted=deleted_filter)


@router.get("/orders/{order_id}", response_model=OrderOut)
async def get_logist_order(
    order_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> Order:
    del current_user
    return await get_order_by_id(db, order_id)


@router.patch("/orders/{order_id}", response_model=OrderOut)
async def update_logist_order(
    order_id: UUID,
    payload: OrderUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> Order:
    del current_user
    return await update_order_by_logist(db, order_id=order_id, payload=payload)


@router.delete("/orders/{order_id}", response_model=OrderDeleteOut)
async def delete_logist_order(
    order_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> OrderDeleteOut:
    del current_user
    await delete_order_by_id(db, order_id)
    return OrderDeleteOut(ok=True, message="Order moved to archive")


@router.get("/orders/{order_id}/dispatch-history", response_model=DispatchHistoryOut)
async def get_dispatch_history(
    order_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> DispatchHistoryOut:
    del current_user
    return await build_dispatch_history(db, order_id)


@router.get("/orders/{order_id}/history", response_model=OrderHistoryOut)
async def get_order_history(
    order_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> OrderHistoryOut:
    del current_user
    return await build_order_status_history(db, order_id)


@router.post("/orders/{order_id}/redispatch", response_model=OrderOut)
async def redispatch_order(
    order_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> Order:
    del current_user
    return await restart_dispatch_for_order(db, order_id)


@router.patch("/orders/{order_id}/clarification-resolve", response_model=OrderOut)
async def resolve_clarification(
    order_id: UUID,
    payload: ClarificationResolveRequest | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> Order:
    return await resolve_order_clarification(
        db,
        order_id=order_id,
        resolved_by_user_id=current_user.id,
        comment=payload.comment if payload is not None else None,
    )
