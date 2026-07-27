from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from botocore.exceptions import ClientError
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from jose import JWTError, jwt
from sqlalchemy import delete, inspect as sa_inspect, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.db.database import get_db
from app.models.models import (
    Client,
    Driver,
    Order,
    Quarry,
    Role,
    SpecialEquipmentListing,
    SupportMessage,
    SupportTicket,
    User,
)
from app.schemas.support import (
    SupportAttachmentConfirmRequest,
    SupportAttachmentConfirmResponse,
    SupportAttachmentPresignRequest,
    SupportAttachmentPresignResponse,
    SupportMessageCreate,
    SupportMessageUpdate,
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
    send_support_operator_notification,
    send_support_reply_notification,
)
from app.services.storage import (
    StorageNotConfiguredError,
    StorageValidationError,
    get_storage_service,
)

router = APIRouter()
message_router = APIRouter(prefix="/support", tags=["support"])


@router.get("/support", response_model=dict[str, str])
async def support_service_status() -> dict[str, str]:
    """Lightweight route used to verify that the support router is mounted."""
    return {"status": "ok", "service": "support"}


@dataclass
class SupportActor:
    role: str
    client: Client | None = None
    user: User | None = None

    @property
    def is_operator(self) -> bool:
        return self.role in {"admin", "logist"}


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
    if role_name not in {"driver", "supplier"}:
        raise HTTPException(
            status_code=403,
            detail="Обращения доступны клиентам, водителям и поставщикам",
        )
    return SupportActor(role=role_name, user=user)


async def get_support_session_actor(
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
    if role_name not in {"driver", "supplier", "admin", "logist"}:
        raise HTTPException(
            status_code=403,
            detail="Обращения доступны клиентам, водителям, поставщикам, администраторам и логистам",
        )
    return SupportActor(role=role_name, user=user)


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
        select(SupportTicket)
        .options(*_ticket_load_options())
        .where(SupportTicket.id == ticket_id)
        .execution_options(populate_existing=True)
    )
    ticket = result.scalar_one_or_none()
    if ticket is None:
        raise HTTPException(status_code=404, detail="Обращение не найдено")
    return ticket


def _actor_owns_ticket(actor: SupportActor, ticket: SupportTicket) -> bool:
    if actor.client is not None:
        return ticket.client_id == actor.client.id
    return actor.user is not None and ticket.user_id == actor.user.id


def _actor_can_access_ticket(actor: SupportActor, ticket: SupportTicket) -> bool:
    return actor.is_operator or _actor_owns_ticket(actor, ticket)


def _actor_owns_message(actor: SupportActor, message: SupportMessage) -> bool:
    if actor.client is not None:
        return message.author_client_id == actor.client.id
    return actor.user is not None and message.author_user_id == actor.user.id


def _message_is_operator_authored(message: SupportMessage) -> bool:
    if message.author_client_id is not None:
        return False
    user = message.author_user
    return bool(user and user.role and user.role.name in {"admin", "logist"})


def _validate_ticket_open_for_message(ticket: SupportTicket) -> None:
    if ticket.status == "closed":
        raise HTTPException(status_code=409, detail="Обращение уже закрыто")


async def _delete_ticket_with_messages(db: AsyncSession, ticket: SupportTicket) -> None:
    await db.execute(delete(SupportMessage).where(SupportMessage.ticket_id == ticket.id))
    await db.delete(ticket)
    await db.commit()


async def _resolve_support_reply_target(
    db: AsyncSession,
    ticket: SupportTicket,
) -> tuple[UUID | None, UUID | None, UUID | None]:
    if ticket.client_id is not None:
        return ticket.client_id, None, None

    if ticket.user is not None:
        driver_profile = _get_loaded_driver_profile(ticket.user)
        if driver_profile is not None:
            return None, driver_profile.id, None
        if ticket.user.role is not None and ticket.user.role.name == "supplier":
            return None, None, ticket.user.id

    if ticket.user_id is None:
        return None, None, None

    driver_id = await db.scalar(select(Driver.id).where(Driver.user_id == ticket.user_id))
    if driver_id is not None:
        return None, driver_id, None
    return None, None, ticket.user_id


def _get_loaded_driver_profile(user: User | None) -> Driver | None:
    if user is None:
        return None

    state = sa_inspect(user)
    if "driver_profile" in state.unloaded:
        return None

    return user.driver_profile


def _resolve_driver_requester_phone(
    ticket: SupportTicket,
    actor: SupportActor | None = None,
) -> str | None:
    user = ticket.user
    if user is None:
        return None

    driver_profile = _get_loaded_driver_profile(user)
    if (
        driver_profile is None
        and actor is not None
        and actor.user is not None
        and actor.user.id == user.id
    ):
        driver_profile = _get_loaded_driver_profile(actor.user)

    if driver_profile is not None and driver_profile.phone:
        return driver_profile.phone

    username = (user.username or "").strip()
    return username or None


def _message_payload(message: SupportMessage, actor: SupportActor | None = None) -> dict:
    if message.author_client is not None:
        name = message.author_client.name
        role = "client"
    else:
        user = message.author_user
        role = user.role.name if user and user.role else "operator"
        name = "Поддержка" if role in {"admin", "logist"} else (
            (user.display_name or user.username) if user else "Оператор"
        )
    return {
        "id": message.id,
        "ticket_id": message.ticket_id,
        "sender_id": message.author_client_id or message.author_user_id,
        "author_client_id": message.author_client_id,
        "author_user_id": message.author_user_id,
        "author_name": name,
        "author_role": role,
        "text": message.text,
        "attachment_url": message.attachment_url,
        "is_read": message.is_read,
        "is_own": _actor_owns_message(actor, message) if actor is not None else False,
        "created_at": message.created_at,
    }


def _ticket_payload(ticket: SupportTicket, actor: SupportActor | None = None) -> dict:
    if ticket.client is not None:
        requester_name = ticket.client.name
        requester_phone = ticket.client.phone
        requester_role = "client"
    else:
        requester_name = ticket.user.display_name or ticket.user.username
        requester_phone = _resolve_driver_requester_phone(ticket, actor)
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
        "messages": [_message_payload(item, actor) for item in messages],
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


async def _get_message(db: AsyncSession, message_id: UUID) -> SupportMessage:
    result = await db.execute(
        select(SupportMessage)
        .options(
            selectinload(SupportMessage.author_client),
            selectinload(SupportMessage.author_user).selectinload(User.role),
            selectinload(SupportMessage.ticket).options(*_ticket_load_options()),
        )
        .where(SupportMessage.id == message_id)
    )
    message = result.scalar_one_or_none()
    if message is None:
        raise HTTPException(status_code=404, detail="Сообщение не найдено")
    return message


@router.post("/support/tickets", response_model=SupportTicketOut, status_code=201)
async def create_support_ticket(
    payload: SupportTicketCreate,
    background_tasks: BackgroundTasks,
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
            attachment_url=payload.attachment_url,
        )
    )
    await db.commit()
    ticket = await _get_ticket(db, ticket.id)
    background_tasks.add_task(send_support_operator_notification, ticket.id, True)
    return _ticket_payload(ticket, actor)


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
    return [_ticket_payload(item, actor) for item in result.scalars().unique().all()]


@router.get("/support/tickets/{ticket_id}", response_model=SupportTicketOut)
async def get_own_support_ticket(
    ticket_id: UUID,
    db: AsyncSession = Depends(get_db),
    actor: SupportActor = Depends(get_support_actor),
):
    ticket = await _get_ticket(db, ticket_id)
    if not _actor_owns_ticket(actor, ticket):
        raise HTTPException(status_code=404, detail="Обращение не найдено")
    return _ticket_payload(ticket, actor)


@router.delete("/support/tickets/{ticket_id}", response_model=dict[str, bool])
@message_router.delete("/tickets/{ticket_id}", response_model=dict[str, bool])
async def delete_own_support_ticket(
    ticket_id: UUID,
    db: AsyncSession = Depends(get_db),
    actor: SupportActor = Depends(get_support_actor),
):
    ticket = await _get_ticket(db, ticket_id)
    if not _actor_owns_ticket(actor, ticket):
        raise HTTPException(status_code=403, detail="Нет доступа к удалению этого чата")
    await _delete_ticket_with_messages(db, ticket)
    return {"ok": True}


@router.post("/support/tickets/{ticket_id}/messages", response_model=SupportTicketOut)
async def add_own_support_message(
    ticket_id: UUID,
    payload: SupportMessageCreate,
    background_tasks: BackgroundTasks,
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
            text=payload.text or "",
            attachment_url=payload.attachment_url,
        )
    )
    ticket.updated_at = datetime.now(timezone.utc)
    await db.commit()
    ticket = await _get_ticket(db, ticket.id)
    background_tasks.add_task(send_support_operator_notification, ticket.id, False)
    return _ticket_payload(ticket, actor)


@message_router.patch("/tickets/{ticket_id}/read", response_model=SupportTicketOut)
async def mark_support_ticket_read(
    ticket_id: UUID,
    db: AsyncSession = Depends(get_db),
    actor: SupportActor = Depends(get_support_session_actor),
):
    ticket = await _get_ticket(db, ticket_id)
    if not _actor_can_access_ticket(actor, ticket):
        raise HTTPException(status_code=404, detail="Обращение не найдено")

    updated = False
    for message in ticket.messages:
        should_mark = (
            not _message_is_operator_authored(message)
            if actor.is_operator
            else _message_is_operator_authored(message)
        )
        if should_mark and not message.is_read:
            message.is_read = True
            updated = True

    if updated:
        await db.commit()

    return _ticket_payload(await _get_ticket(db, ticket.id), actor)


@message_router.patch("/messages/{message_id}", response_model=SupportTicketOut)
async def update_support_message(
    message_id: UUID,
    payload: SupportMessageUpdate,
    db: AsyncSession = Depends(get_db),
    actor: SupportActor = Depends(get_support_session_actor),
):
    message = await _get_message(db, message_id)
    ticket = message.ticket
    if ticket is None or not _actor_can_access_ticket(actor, ticket):
        raise HTTPException(status_code=404, detail="Обращение не найдено")
    _validate_ticket_open_for_message(ticket)
    if not _actor_owns_message(actor, message):
        raise HTTPException(status_code=403, detail="Можно изменять только свои сообщения")

    message.text = payload.text
    message.is_read = False
    ticket.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return _ticket_payload(await _get_ticket(db, ticket.id), actor)


@message_router.delete("/messages/{message_id}", response_model=SupportTicketOut)
async def delete_support_message(
    message_id: UUID,
    db: AsyncSession = Depends(get_db),
    actor: SupportActor = Depends(get_support_session_actor),
):
    message = await _get_message(db, message_id)
    ticket = message.ticket
    if ticket is None or not _actor_can_access_ticket(actor, ticket):
        raise HTTPException(status_code=404, detail="Обращение не найдено")
    _validate_ticket_open_for_message(ticket)
    if not _actor_owns_message(actor, message):
        raise HTTPException(status_code=403, detail="Можно удалять только свои сообщения")

    await db.delete(message)
    ticket.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return _ticket_payload(await _get_ticket(db, ticket.id), actor)


@router.get("/admin/support/tickets", response_model=list[SupportTicketOut])
async def list_operator_support_tickets(
    ticket_status: str | None = Query(default=None, alias="status"),
    category: str | None = Query(default=None, max_length=50),
    requester_role: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    actor = SupportActor(
        role=current_user.role.name if current_user.role else "operator",
        user=current_user,
    )
    stmt = select(SupportTicket).options(*_ticket_load_options())
    if ticket_status:
        stmt = stmt.where(SupportTicket.status == ticket_status)
    if category:
        stmt = stmt.where(SupportTicket.category == category)
    if requester_role == "client":
        stmt = stmt.where(SupportTicket.client_id.is_not(None))
    elif requester_role:
        stmt = stmt.join(SupportTicket.user).join(User.role).where(Role.name == requester_role)
    result = await db.execute(stmt.order_by(SupportTicket.updated_at.desc()))
    return [_ticket_payload(item, actor) for item in result.scalars().unique().all()]


@router.get("/admin/support/tickets/{ticket_id}", response_model=SupportTicketOut)
async def get_operator_support_ticket(
    ticket_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    actor = SupportActor(
        role=current_user.role.name if current_user.role else "operator",
        user=current_user,
    )
    return _ticket_payload(await _get_ticket(db, ticket_id), actor)


@router.delete("/admin/support/tickets/{ticket_id}", response_model=dict[str, bool])
async def delete_operator_support_ticket(
    ticket_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    ticket = await _get_ticket(db, ticket_id)
    await _delete_ticket_with_messages(db, ticket)
    return {"ok": True}


@router.post("/admin/support/tickets/{ticket_id}/messages", response_model=SupportTicketOut)
async def add_operator_support_message(
    ticket_id: UUID,
    payload: SupportMessageCreate,
    background_tasks: BackgroundTasks,
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
            text=payload.text or "",
            attachment_url=payload.attachment_url,
        )
    )
    if ticket.status == "new":
        ticket.status = "in_progress"
    ticket.assigned_to_user_id = current_user.id
    ticket.updated_at = datetime.now(timezone.utc)
    await db.commit()
    ticket = await _get_ticket(db, ticket.id)
    client_id, driver_id, user_id = await _resolve_support_reply_target(db, ticket)
    background_tasks.add_task(
        send_support_reply_notification,
        ticket_id=ticket.id,
        client_id=client_id,
        driver_id=driver_id,
        user_id=user_id,
    )
    actor = SupportActor(
        role=current_user.role.name if current_user.role else "operator",
        user=current_user,
    )
    return _ticket_payload(ticket, actor)


@router.post(
    "/support/tickets/{ticket_id}/attachments/presign-upload",
    response_model=SupportAttachmentPresignResponse,
)
async def presign_support_attachment_upload(
    ticket_id: UUID,
    payload: SupportAttachmentPresignRequest,
    db: AsyncSession = Depends(get_db),
    actor: SupportActor = Depends(get_support_session_actor),
) -> SupportAttachmentPresignResponse:
    ticket = await _get_ticket(db, ticket_id)
    if not _actor_can_access_ticket(actor, ticket):
        raise HTTPException(status_code=404, detail="Обращение не найдено")
    _validate_ticket_open_for_message(ticket)

    try:
        storage = get_storage_service()
        storage.assert_supported_image(payload.file_name, payload.content_type, payload.file_size)
    except StorageNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except StorageValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    object_key = storage.build_object_key("support_ticket", payload.file_name)
    return SupportAttachmentPresignResponse(
        bucket=storage.bucket,
        object_key=object_key,
        upload_url=storage.generate_presigned_put(object_key, payload.content_type),
        public_url=storage.build_public_url(object_key),
        expires_in=3600,
    )


@router.post(
    "/support/tickets/{ticket_id}/attachments/confirm",
    response_model=SupportAttachmentConfirmResponse,
)
async def confirm_support_attachment_upload(
    ticket_id: UUID,
    payload: SupportAttachmentConfirmRequest,
    db: AsyncSession = Depends(get_db),
    actor: SupportActor = Depends(get_support_session_actor),
) -> SupportAttachmentConfirmResponse:
    ticket = await _get_ticket(db, ticket_id)
    if not _actor_can_access_ticket(actor, ticket):
        raise HTTPException(status_code=404, detail="Обращение не найдено")
    _validate_ticket_open_for_message(ticket)

    try:
        storage = get_storage_service()
    except StorageNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    try:
        head_data = storage.head_object(payload.object_key)
    except ClientError as exc:
        raise HTTPException(status_code=404, detail="Загруженный файл не найден в хранилище") from exc

    file_name = payload.file_name or Path(payload.object_key).name
    content_type = payload.content_type or head_data.get("ContentType")
    file_size = payload.file_size or head_data.get("ContentLength")
    if not content_type or not file_size:
        raise HTTPException(status_code=400, detail="Не удалось определить метаданные файла")

    try:
        storage.assert_supported_image(file_name, content_type, file_size)
    except StorageValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return SupportAttachmentConfirmResponse(public_url=storage.build_public_url(payload.object_key))


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
    actor = SupportActor(
        role=current_user.role.name if current_user.role else "operator",
        user=current_user,
    )
    return _ticket_payload(await _get_ticket(db, ticket.id), actor)
