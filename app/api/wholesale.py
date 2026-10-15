from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import get_db
from app.models.models import City, Driver, Material, Role, User
from app.models.commerce import WholesaleEvent, WholesaleFavorite, WholesaleRequest
from app.schemas.commerce import AccessInput, ModerationInput, WholesaleInput, WholesaleOut
from app.services.notification_outbox import enqueue
from app.security.auth import OrderAccessActor, get_current_admin_user, get_current_order_actor

router = APIRouter(prefix="/wholesale-requests", tags=["wholesale"])
PARTNER_ROLES = {"driver", "supplier"}


def today():
    return datetime.now(ZoneInfo(settings.PAYMENT_REPORT_TIMEZONE)).date()


async def board_user(actor: OrderAccessActor = Depends(get_current_order_actor)):
    user = actor.user if isinstance(actor, OrderAccessActor) else actor
    if user is None:
        raise HTTPException(403, "Раздел доступен только партнёрам")
    if not user.is_active or user.is_deleted:
        raise HTTPException(401, "Аккаунт заблокирован")
    if user.driver_profile is not None and user.driver_profile.moderation_status == "suspended":
        raise HTTPException(403, "Профиль водителя заблокирован")
    role = user.role.name
    if role == "driver":
        driver = user.driver_profile
        vehicle = driver.vehicle if driver else None
        if (not driver or not driver.is_active or driver.moderation_status != "approved"
                or not vehicle or not vehicle.is_active or vehicle.moderation_status != "approved"):
            raise HTTPException(403, "Для просмотра оптовых заявок необходимо завершить оформление профиля и пройти модерацию администратором.")
    if role in {"admin", "logist"}:
        return user
    if role not in PARTNER_ROLES:
        raise HTTPException(403, "Раздел доступен только водителям и поставщикам")
    return user


def is_staff(user):
    return user.role.name in {"admin", "logist"}


def visible(request):
    return request.status == "approved" and request.ends_on >= today()


async def get_request(db, request_id, *, lock=False):
    query = select(WholesaleRequest).where(WholesaleRequest.id == request_id)
    if lock:
        query = query.with_for_update()
    request = await db.scalar(query)
    if not request:
        raise HTTPException(404, "Заявка не найдена")
    return request


def change_status(db, request, user, status, reason=None):
    request.status = status
    request.reject_reason = reason if status == "rejected" else None
    event = WholesaleEvent(request_id=request.id, actor_id=user.id if user else None, status=status, reason=reason)
    db.add(event)
    return event


async def notify_admins_pending(db, request, event, *, resubmitted=False):
    # The moderation event, inbox and PUSH outbox share the request transaction.
    await db.flush()
    recipients = await db.scalars(select(User.id).join(Role, User.role_id == Role.id).where(
        Role.name == "admin", User.is_active.is_(True), User.is_deleted.is_(False),
        User.id != request.author_id))
    title = "Оптовая заявка снова на модерации" if resubmitted else "Новая оптовая заявка"
    for admin_id in recipients:
        await enqueue(db, key=f"wholesale:{event.id}:admin:{admin_id}",
                      recipient_type="user", recipient_id=admin_id,
                      event_type="wholesale_pending", title=title,
                      body=f"{request.material_name[:200]}. Требуется проверка заявки.",
                      payload={"wholesale_request_id": str(request.id), "wholesale_event_id": str(event.id),
                               "status": "pending"}, inbox=True)


async def serialize(db, request, user):
    result = WholesaleOut.model_validate(request)
    result.is_owner = request.author_id == user.id
    result.is_favorite = bool(await db.scalar(select(WholesaleFavorite.enabled).where(
        WholesaleFavorite.request_id == request.id, WholesaleFavorite.user_id == user.id)))
    return result


@router.get("/access")
async def access(user: User = Depends(board_user)):
    return {"enabled": is_staff(user) or user.role.name in PARTNER_ROLES, "can_moderate": user.role.name == "admin"}


@router.get("")
async def feed(view: str = Query("all", pattern="^(all|mine|favorites|moderation)$"), q: str = "", city_id: UUID | None = None,
               starts_on: str | None = None, ends_on: str | None = None, page: int = Query(1, ge=1),
               page_size: int = Query(20, ge=1, le=100),
               status: str | None = Query(None, pattern="^(pending|approved|rejected|archived|all)$"), user: User = Depends(board_user), db: AsyncSession = Depends(get_db)):
    from datetime import date
    conditions = []
    if status is not None and view != "moderation":
        raise HTTPException(422, "Фильтр статуса доступен только в модерации")
    if view == "mine":
        conditions.append(WholesaleRequest.author_id == user.id)
    elif view == "moderation":
        if user.role.name != "admin":
            raise HTTPException(403, "Только администратор")
        conditions.append(WholesaleRequest.status != "draft")
        if status != "all":
            conditions.append(WholesaleRequest.status == (status or "pending"))
    elif view == "all" and user.role.name == "supplier":
        conditions.append(or_(WholesaleRequest.author_id == user.id,
                              and_(WholesaleRequest.status == "approved", WholesaleRequest.ends_on >= today())))
    else:
        conditions.extend([WholesaleRequest.status == "approved", WholesaleRequest.ends_on >= today()])
    if view == "favorites":
        conditions.append(exists().where(WholesaleFavorite.request_id == WholesaleRequest.id, WholesaleFavorite.user_id == user.id, WholesaleFavorite.enabled.is_(True)))
    if q:
        conditions.append(WholesaleRequest.material_name.ilike(f"%{q}%"))
    if city_id:
        conditions.append(WholesaleRequest.city_id == city_id)
    try:
        if starts_on:
            conditions.append(WholesaleRequest.ends_on >= date.fromisoformat(starts_on))
        if ends_on:
            conditions.append(WholesaleRequest.starts_on <= date.fromisoformat(ends_on))
    except ValueError:
        raise HTTPException(422, "Проверьте даты")
    total = await db.scalar(select(func.count()).select_from(WholesaleRequest).where(*conditions))
    rows = (await db.scalars(select(WholesaleRequest).where(*conditions).order_by(WholesaleRequest.created_at.desc(), WholesaleRequest.id).offset((page - 1) * page_size).limit(page_size))).all()
    return {"items": [await serialize(db, row, user) for row in rows], "total": total, "page": page, "page_size": page_size}


async def validate_input(db, payload):
    city = await db.get(City, payload.city_id)
    if not city or not city.is_active:
        raise HTTPException(422, "Выберите доступный город")
    if payload.ends_on < today():
        raise HTTPException(422, "Срок заявки уже закончился")
    if payload.material_id:
        material = await db.get(Material, payload.material_id)
        if not material or not material.is_active:
            raise HTTPException(422, "Материал недоступен")
        payload.material_name = material.name


@router.post("", response_model=WholesaleOut, status_code=201)
async def create(payload: WholesaleInput, draft: bool = False, user: User = Depends(board_user), db: AsyncSession = Depends(get_db)):
    await validate_input(db, payload)
    request = WholesaleRequest(**payload.model_dump(), author_id=user.id)
    db.add(request)
    await db.flush()
    event = change_status(db, request, user, "draft" if draft else "pending")
    if not draft:
        await notify_admins_pending(db, request, event)
    await db.commit()
    await db.refresh(request)
    return await serialize(db, request, user)


@router.get("/{request_id}", response_model=WholesaleOut)
async def detail(request_id: UUID, user: User = Depends(board_user), db: AsyncSession = Depends(get_db)):
    request = await get_request(db, request_id)
    if request.author_id != user.id and (request.status == "draft" or (not is_staff(user) and not visible(request))):
        raise HTTPException(404, "Заявка недоступна")
    return await serialize(db, request, user)


@router.put("/{request_id}", response_model=WholesaleOut)
async def edit(request_id: UUID, payload: WholesaleInput, draft: bool = False, user: User = Depends(board_user), db: AsyncSession = Depends(get_db)):
    request = await get_request(db, request_id, lock=True)
    if request.author_id != user.id:
        raise HTTPException(403, "Можно изменять только свои заявки")
    if request.status == "archived":
        raise HTTPException(409, "Архивную заявку нельзя редактировать")
    await validate_input(db, payload)
    for key, value in payload.model_dump().items():
        setattr(request, key, value)
    event = change_status(db, request, user, "draft" if draft else "pending")
    if not draft:
        await notify_admins_pending(db, request, event, resubmitted=True)
    await db.commit()
    await db.refresh(request)
    return await serialize(db, request, user)


@router.post("/{request_id}/submit", response_model=WholesaleOut)
async def submit(request_id: UUID, user: User = Depends(board_user), db: AsyncSession = Depends(get_db)):
    request = await get_request(db, request_id, lock=True)
    if request.author_id != user.id:
        raise HTTPException(403, "Можно отправить только свою заявку")
    if request.status == "pending" and request.ends_on >= today():
        return await serialize(db, request, user)
    if request.status not in {"draft", "pending", "rejected"} or request.ends_on < today():
        raise HTTPException(409, "Сначала отредактируйте заявку и проверьте сроки")
    event = change_status(db, request, user, "pending")
    await notify_admins_pending(db, request, event, resubmitted=True)
    await db.commit()
    await db.refresh(request)
    return await serialize(db, request, user)


@router.post("/{request_id}/close", response_model=WholesaleOut)
async def close(request_id: UUID, user: User = Depends(board_user), db: AsyncSession = Depends(get_db)):
    request = await get_request(db, request_id, lock=True)
    if request.author_id != user.id and user.role.name != "admin":
        raise HTTPException(403, "Нет доступа")
    change_status(db, request, user, "archived")
    await db.commit()
    await db.refresh(request)
    return await serialize(db, request, user)


@router.post("/{request_id}/moderate", response_model=WholesaleOut)
async def moderate(request_id: UUID, payload: ModerationInput, user: User = Depends(get_current_admin_user), db: AsyncSession = Depends(get_db)):
    request = await get_request(db, request_id, lock=True)
    action = {"publish": "approve", "hide": "archive"}.get(payload.action, payload.action)
    target = {"approve": "approved", "reject": "rejected", "archive": "archived"}[action]
    reason = (payload.reason or "").strip()
    if action == "reject" and not reason:
        raise HTTPException(422, "Укажите причину отклонения")
    # Repeated delivery of the same decision must not duplicate PUSH or history.
    if request.status == target and (action != "reject" or request.reject_reason == reason):
        return await serialize(db, request, user)
    if action in {"approve", "reject"} and request.status != "pending":
        raise HTTPException(409, "Решение можно принять только по заявке на модерации")
    if action == "approve" and request.ends_on < today():
        raise HTTPException(409, "Срок заявки закончился")
    event = change_status(db, request, user, target, reason or None)
    await db.flush()
    if action in {"approve", "reject"}:
        title = "Оптовая заявка одобрена" if action == "approve" else "Оптовая заявка отклонена"
        body = ("Заявка опубликована в общей ленте." if action == "approve"
                else f"Причина: {reason[:500]}" + ("…" if len(reason) > 500 else ""))
        driver_id = await db.scalar(select(Driver.id).where(Driver.user_id == request.author_id))
        await enqueue(db, key=f"wholesale:{event.id}:{request.author_id}",
                      recipient_type="driver" if driver_id else "user",
                      recipient_id=driver_id or request.author_id,
                      event_type=f"wholesale_{target}", title=title, body=body,
                      payload={"wholesale_request_id": str(request.id), "wholesale_event_id": str(event.id), "status": target},
                      inbox=driver_id is None)
    await db.commit()
    await db.refresh(request)
    return await serialize(db, request, user)


@router.put("/{request_id}/favorite")
async def favorite(request_id: UUID, payload: AccessInput, user: User = Depends(board_user), db: AsyncSession = Depends(get_db)):
    request = await get_request(db, request_id)
    if not visible(request):
        raise HTTPException(404, "Заявка недоступна")
    from sqlalchemy.dialects.postgresql import insert
    await db.execute(insert(WholesaleFavorite).values(user_id=user.id, request_id=request.id, enabled=payload.enabled)
                     .on_conflict_do_update(index_elements=["user_id", "request_id"], set_={"enabled": payload.enabled}))
    await db.commit()
    return {"enabled": payload.enabled}


@router.get("/{request_id}/history")
async def history(request_id: UUID, user: User = Depends(board_user), db: AsyncSession = Depends(get_db)):
    request = await get_request(db, request_id)
    if request.author_id != user.id and (request.status == "draft" or user.role.name != "admin"):
        raise HTTPException(403, "Нет доступа")
    rows = (await db.scalars(select(WholesaleEvent).where(WholesaleEvent.request_id == request_id).order_by(WholesaleEvent.created_at))).all()
    return [{"status": r.status, "reason": r.reason, "created_at": r.created_at} for r in rows]
