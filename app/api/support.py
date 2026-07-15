from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.db.database import get_db
from app.models.models import (
    Client,
    Driver,
    Order,
    Quarry,
    SpecialEquipmentListing,
    SupportMessage,
    SupportTicket,
    User,
)
from app.schemas.support import (
    SupportMessageCreate,
    SupportTicketCreate,
    SupportTicketOut,
    SupportStatusUpdate,
)
from app.security.auth import (
    get_current_client,
    get_current_logist_user,
    get_current_user,
    oauth2_scheme,
)
from app.services.notifications import (
    schedule_support_operator_notification,
    schedule_support_reply_notification,
)

router = APIRouter()


@dataclass
class SupportActor:
    role: str
    client: Client | None = None
    user: User | None = None


async def get_support_actor(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> SupportActor:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Could not validate credentials") from exc
    role = payload.get("role")
    if role == "client":
        return SupportActor(role="client", client=await get_current_client(token=token, db=db))
    user = await get_current_user(token=token, db=db)
    role_name = user.role.name if user.role else ""
    if role_name != "driver":
        raise HTTPException(status_code=403, detail="Обращения доступны клиентам и водителям")
    return SupportActor(role="driver", user=user)


def _ticket_load_options():
    return (
        selectinload(SupportTicket.client),
        selectinload(SupportTicket.user).selectinload(User.role),
        selectinload(SupportTicket.user).selectinload(User.driver_profile),
        selectinload(SupportTicket.assigned_to),
        selectinload(SupportTicket.messages).selectinload(SupportMessage.author_client),
        selectinload(SupportTicket.messages)
        .selectinload(SupportMessage.author_user)
        .selectinload(User.role),
    )


async def _get_ticket(db: AsyncSession, ticket_id: UUID) -> SupportTicket:
    result = await db.execute(
        select(SupportTicket).options(*_ticket_load_options()).where(SupportTicket.id == ticket_id)
    )
    ticket = result.scalar_one_or_none()
    if ticket is None:
        raise HTTPException(status_code=404, detail="Обращение не найдено")
    return ticket


def _actor_owns_ticket(actor: SupportActor, ticket: SupportTicket) -> bool:
    if actor.client is not None:
        return ticket.client_id == actor.client.id
    return actor.user is not None and ticket.user_id == actor.user.id


def _message_payload(message: SupportMessage) -> dict:
    if message.author_client is not None:
        name = message.author_client.name
        role = "client"
    else:
        user = message.author_user
        name = (user.display_name or user.username) if user else "Оператор"
        role = user.role.name if user and user.role else "operator"
    return {
        "id": message.id,
        "ticket_id": message.ticket_id,
        "author_client_id": message.author_client_id,
        "author_user_id": message.author_user_id,
        "author_name": name,
        "author_role": role,
        "text": message.text,
        "created_at": message.created_at,
    }


def _ticket_payload(ticket: SupportTicket) -> dict:
    if ticket.client is not None:
        requester_name = ticket.client.name
        requester_phone = ticket.client.phone
        requester_role = "client"
    else:
        requester_name = ticket.user.display_name or ticket.user.username
        requester_phone = (
            ticket.user.driver_profile.phone if ticket.user.driver_profile is not None else None
        )
        requester_role = ticket.user.role.name if ticket.user.role else "driver"
    messages = sorted(ticket.messages, key=lambda item: item.created_at)
    return {
        "id": ticket.id,
        "subject": ticket.subject,
        "category": ticket.category,
        "context_type": ticket.context_type,
        "context_id": ticket.context_id,
        "status": ticket.status,
        "requester_name": requester_name,
        "requester_phone": requester_phone,
        "requester_role": requester_role,
        "assigned_to_user_id": ticket.assigned_to_user_id,
        "messages": [_message_payload(item) for item in messages],
        "created_at": ticket.created_at,
        "updated_at": ticket.updated_at,
        "closed_at": ticket.closed_at,
    }


async def _validate_context(
    db: AsyncSession,
    actor: SupportActor,
    context_type: str,
    context_id: UUID | None,
) -> None:
    if context_type == "general":
        return
    if context_id is None:
        raise HTTPException(status_code=400, detail="Не указан объект обращения")
    if context_type == "order":
        order = await db.get(Order, context_id)
        if order is None:
            raise HTTPException(status_code=404, detail="Заказ не найден")
        if actor.client is not None and order.client_id != actor.client.id:
            raise HTTPException(status_code=403, detail="Нет доступа к заказу")
        if actor.user is not None:
            driver = actor.user.driver_profile
            if driver is None or order.driver_id != driver.id:
                raise HTTPException(status_code=403, detail="Нет доступа к заказу")
        return
    model = {
        "pickup_point": Quarry,
        "equipment_listing": SpecialEquipmentListing,
        "user": User,
    }[context_type]
    if await db.get(model, context_id) is None:
        raise HTTPException(status_code=404, detail="Связанный объект не найден")


@router.post("/support/tickets", response_model=SupportTicketOut, status_code=201)
async def create_support_ticket(
    payload: SupportTicketCreate,
    db: AsyncSession = Depends(get_db),
    actor: SupportActor = Depends(get_support_actor),
):
    await _validate_context(db, actor, payload.context_type, payload.context_id)
    ticket = SupportTicket(
        client_id=actor.client.id if actor.client else None,
        user_id=actor.user.id if actor.user else None,
        subject=payload.subject,
        category=payload.category,
        context_type=payload.context_type,
        context_id=payload.context_id,
        status="new",
    )
    db.add(ticket)
    await db.flush()
    db.add(
        SupportMessage(
            ticket_id=ticket.id,
            author_client_id=actor.client.id if actor.client else None,
            author_user_id=actor.user.id if actor.user else None,
            text=payload.message,
        )
    )
    await db.commit()
    ticket = await _get_ticket(db, ticket.id)
    schedule_support_operator_notification(ticket.id, is_new=True)
    return _ticket_payload(ticket)


@router.get("/support/tickets", response_model=list[SupportTicketOut])
async def list_own_support_tickets(
    db: AsyncSession = Depends(get_db),
    actor: SupportActor = Depends(get_support_actor),
):
    stmt = select(SupportTicket).options(*_ticket_load_options())
    if actor.client is not None:
        stmt = stmt.where(SupportTicket.client_id == actor.client.id)
    else:
        stmt = stmt.where(SupportTicket.user_id == actor.user.id)
    result = await db.execute(stmt.order_by(SupportTicket.updated_at.desc()))
    return [_ticket_payload(item) for item in result.scalars().unique().all()]


@router.get("/support/tickets/{ticket_id}", response_model=SupportTicketOut)
async def get_own_support_ticket(
    ticket_id: UUID,
    db: AsyncSession = Depends(get_db),
    actor: SupportActor = Depends(get_support_actor),
):
    ticket = await _get_ticket(db, ticket_id)
    if not _actor_owns_ticket(actor, ticket):
        raise HTTPException(status_code=404, detail="Обращение не найдено")
    return _ticket_payload(ticket)


@router.post("/support/tickets/{ticket_id}/messages", response_model=SupportTicketOut)
async def add_own_support_message(
    ticket_id: UUID,
    payload: SupportMessageCreate,
    db: AsyncSession = Depends(get_db),
    actor: SupportActor = Depends(get_support_actor),
):
    ticket = await _get_ticket(db, ticket_id)
    if not _actor_owns_ticket(actor, ticket):
        raise HTTPException(status_code=404, detail="Обращение не найдено")
    if ticket.status == "closed":
        raise HTTPException(status_code=409, detail="Обращение уже закрыто")
    db.add(
        SupportMessage(
            ticket_id=ticket.id,
            author_client_id=actor.client.id if actor.client else None,
            author_user_id=actor.user.id if actor.user else None,
            text=payload.text,
        )
    )
    ticket.updated_at = datetime.now(timezone.utc)
    await db.commit()
    schedule_support_operator_notification(ticket.id, is_new=False)
    return _ticket_payload(await _get_ticket(db, ticket.id))


@router.get("/admin/support/tickets", response_model=list[SupportTicketOut])
async def list_operator_support_tickets(
    ticket_status: str | None = Query(default=None, alias="status"),
    category: str | None = Query(default=None, max_length=50),
    requester_role: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    del current_user
    stmt = select(SupportTicket).options(*_ticket_load_options())
    if ticket_status:
        stmt = stmt.where(SupportTicket.status == ticket_status)
    if category:
        stmt = stmt.where(SupportTicket.category == category)
    if requester_role == "client":
        stmt = stmt.where(SupportTicket.client_id.is_not(None))
    elif requester_role == "driver":
        stmt = stmt.where(SupportTicket.user_id.is_not(None))
    result = await db.execute(stmt.order_by(SupportTicket.updated_at.desc()))
    return [_ticket_payload(item) for item in result.scalars().unique().all()]


@router.get("/admin/support/tickets/{ticket_id}", response_model=SupportTicketOut)
async def get_operator_support_ticket(
    ticket_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    del current_user
    return _ticket_payload(await _get_ticket(db, ticket_id))


@router.post("/admin/support/tickets/{ticket_id}/messages", response_model=SupportTicketOut)
async def add_operator_support_message(
    ticket_id: UUID,
    payload: SupportMessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    ticket = await _get_ticket(db, ticket_id)
    if ticket.status == "closed":
        raise HTTPException(status_code=409, detail="Обращение уже закрыто")
    db.add(
        SupportMessage(
            ticket_id=ticket.id,
            author_user_id=current_user.id,
            text=payload.text,
        )
    )
    if ticket.status == "new":
        ticket.status = "in_progress"
    ticket.assigned_to_user_id = current_user.id
    ticket.updated_at = datetime.now(timezone.utc)
    await db.commit()
    ticket = await _get_ticket(db, ticket.id)
    driver_id = ticket.user.driver_profile.id if ticket.user and ticket.user.driver_profile else None
    schedule_support_reply_notification(
        ticket_id=ticket.id,
        client_id=ticket.client_id,
        driver_id=driver_id,
    )
    return _ticket_payload(ticket)


@router.patch("/admin/support/tickets/{ticket_id}/status", response_model=SupportTicketOut)
async def update_support_ticket_status(
    ticket_id: UUID,
    payload: SupportStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    ticket = await _get_ticket(db, ticket_id)
    allowed = {"new": "in_progress", "in_progress": "closed"}
    if allowed.get(ticket.status) != payload.status:
        raise HTTPException(status_code=409, detail="Недопустимый переход статуса обращения")
    ticket.status = payload.status
    ticket.assigned_to_user_id = current_user.id
    ticket.closed_at = datetime.now(timezone.utc) if payload.status == "closed" else None
    ticket.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return _ticket_payload(await _get_ticket(db, ticket.id))
