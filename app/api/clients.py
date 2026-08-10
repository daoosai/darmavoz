import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from datetime import UTC, datetime
from uuid import UUID
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.database import get_db
from app.models.models import Client, ClientAddress, Order, OrderEvent, OrderItem, OrderOffer, OrderOfferStatus, OrderStatus, User
from app.schemas.client import (
    ClientCreate,
    ClientFcmTokenIn,
    ClientFcmTokenOut,
    ClientProfileResponse,
    ClientProfileUpdate,
    ClientResponse,
)
from app.schemas.order import OrderOut
from app.security.auth import get_current_client, get_current_logist_user
from app.services.dispatch_service import get_order_by_id, get_order_material_name, list_orders_for_client
from app.services.fcm_tokens import detach_fcm_token_from_other_entities
from app.services.notifications import create_operator_notifications
from app.schemas.sprint19 import ClientCancelOrderRequest, ClientClarificationReplyRequest, ConfirmationRequest

router = APIRouter()
logger = logging.getLogger(__name__)


def split_client_name(name: str | None) -> tuple[str, str | None]:
    parts = [part for part in (name or "").strip().split() if part]
    if not parts:
        return "", None
    if len(parts) == 1:
        return parts[0], None
    return parts[0], " ".join(parts[1:])


def build_client_profile_response(client: Client) -> ClientProfileResponse:
    first_name, last_name = split_client_name(client.name)
    return ClientProfileResponse(
        id=client.id,
        first_name=first_name,
        last_name=last_name,
        name=client.name,
        phone=client.phone,
        created_at=client.created_at,
    )


@router.post("/", response_model=ClientResponse, status_code=status.HTTP_201_CREATED)
async def create_client(
    payload: ClientCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    existing = await db.execute(select(Client).where(Client.phone == payload.phone))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Client with this phone already exists",
        )

    client = Client(name=payload.name, phone=payload.phone)
    db.add(client)
    await db.commit()
    await db.refresh(client)
    return client


@router.get("/", response_model=List[ClientResponse])
async def list_clients(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    result = await db.execute(select(Client).order_by(Client.name.asc()))
    return result.scalars().all()


@router.get("/me", response_model=ClientProfileResponse)
async def get_my_profile(current_client: Client = Depends(get_current_client)):
    return build_client_profile_response(current_client)


@router.patch("/me", response_model=ClientProfileResponse)
async def update_my_profile(
    payload: ClientProfileUpdate,
    current_client: Client = Depends(get_current_client),
    db: AsyncSession = Depends(get_db),
):
    current_first_name, current_last_name = split_client_name(current_client.name)
    first_name = payload.first_name if payload.first_name is not None else current_first_name
    last_name = payload.last_name if payload.last_name is not None else current_last_name

    if not first_name:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="first_name is required")

    current_client.name = " ".join(part for part in [first_name, last_name] if part)
    await db.commit()
    await db.refresh(current_client)
    return build_client_profile_response(current_client)


@router.post("/me/fcm-token", response_model=ClientFcmTokenOut)
async def save_my_fcm_token(
    payload: ClientFcmTokenIn,
    current_client: Client = Depends(get_current_client),
    db: AsyncSession = Depends(get_db),
) -> ClientFcmTokenOut:
    normalized_token = payload.token.strip()
    logger.info(
        "client_fcm_token_save_requested",
        extra={
            "client_id": str(current_client.id),
            "token_prefix": normalized_token[:24],
        },
    )
    await detach_fcm_token_from_other_entities(
        db,
        normalized_token,
        keep_client_id=current_client.id,
    )
    current_client.fcm_token = normalized_token
    await db.commit()
    return ClientFcmTokenOut(ok=True, token=current_client.fcm_token)


@router.delete("/me/fcm-token", response_model=ClientFcmTokenOut)
async def delete_my_fcm_token(
    current_client: Client = Depends(get_current_client),
    db: AsyncSession = Depends(get_db),
) -> ClientFcmTokenOut:
    logger.info(
        "client_fcm_token_deleted",
        extra={"client_id": str(current_client.id)},
    )
    current_client.fcm_token = None
    await db.commit()
    return ClientFcmTokenOut(ok=True, token=None)


@router.get("/me/orders", response_model=list[OrderOut])
async def get_my_orders(
    current_client: Client = Depends(get_current_client),
    db: AsyncSession = Depends(get_db),
) -> list[Order]:
    return await list_orders_for_client(db, current_client.id)


@router.patch("/me/orders/{order_id}/cancel", response_model=OrderOut)
async def cancel_my_order(order_id: UUID, payload: ClientCancelOrderRequest, current_client: Client = Depends(get_current_client), db: AsyncSession = Depends(get_db)):
    order = await db.scalar(select(Order).where(Order.id == order_id, Order.client_id == current_client.id, Order.is_deleted.is_(False)).with_for_update())
    if order is None:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    allowed = {"draft", "created", "requires_clarification", "searching_driver", "offered_to_driver", "driver_assigned", "no_driver_found", "timeout"}
    if order.status not in allowed:
        raise HTTPException(status_code=409, detail={"code": "ORDER_ALREADY_ACCEPTED", "message": "Заказ уже принят водителем"})
    await db.execute(update(OrderOffer).where(OrderOffer.order_id == order.id, OrderOffer.status == OrderOfferStatus.pending.value).values(status=OrderOfferStatus.cancelled.value))
    order.status = OrderStatus.cancelled.value; order.cancelled_at = datetime.now(UTC); order.cancelled_by_type = "client"; order.cancel_reason = payload.reason or "Отменено клиентом"; order.current_offer_id = None; order.driver_id = None
    db.add(OrderEvent(order_id=order.id, status=order.status, event_type="cancelled_by_client", description=order.cancel_reason))
    await db.commit(); await db.refresh(order); return order


@router.patch("/me/orders/{order_id}/clarify-reply", response_model=OrderOut)
async def reply_to_order_clarification(
    order_id: UUID,
    payload: ClientClarificationReplyRequest,
    current_client: Client = Depends(get_current_client),
    db: AsyncSession = Depends(get_db),
):
    try:
        order = await db.scalar(
            select(Order)
            .options(selectinload(Order.items).selectinload(OrderItem.material))
            .where(
                Order.id == order_id,
                Order.client_id == current_client.id,
                Order.is_deleted.is_(False),
            )
            .with_for_update()
        )
        if order is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заказ не найден")
        if order.status != OrderStatus.requires_clarification.value:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="По этому заказу сейчас не требуется уточнение",
            )

        reply = payload.reply.strip()
        if not reply:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Введите ответ для логиста",
            )
        order.client_clarification_reply = reply
        db.add(
            OrderEvent(
                order_id=order.id,
                status=order.status,
                event_type="client_clarification_reply",
                description=reply,
            )
        )
        await create_operator_notifications(
            db,
            event_type="client_clarification_reply",
            title=f"Получен ответ от клиента по заказу {get_order_material_name(order)}",
            body=reply,
            payload={"order_id": str(order.id), "event": "client_clarification_reply"},
        )
        await db.commit()
        return await get_order_by_id(db, order.id)
    except HTTPException:
        raise
    except Exception:
        await db.rollback()
        logger.error(
            "client_clarification_reply_failed order_id=%s client_id=%s",
            order_id,
            current_client.id,
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Не удалось сохранить ответ. Попробуйте ещё раз.",
        )


@router.delete("/me/account")
async def delete_my_account(payload: ConfirmationRequest, current_client: Client = Depends(get_current_client), db: AsyncSession = Depends(get_db)):
    if not payload.confirm:
        raise HTTPException(status_code=422, detail="Подтвердите удаление аккаунта")
    current_client.is_deleted = True; current_client.deleted_at = datetime.now(UTC); current_client.deletion_source = "self"; current_client.auth_version += 1
    current_client.name = "Удалённый пользователь"; current_client.email = None; current_client.phone = None; current_client.external_source = None; current_client.external_user_id = None; current_client.fcm_token = None
    await db.execute(update(Order).where(Order.client_id == current_client.id).values(address=None, delivery_address=None, notes=None))
    await db.execute(update(ClientAddress).where(ClientAddress.client_id == current_client.id).values(full_address="Удалённый адрес", comment=None, lat=None, lon=None, is_default=False))
    await db.commit()
    return {"ok": True}
