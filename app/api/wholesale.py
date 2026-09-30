from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import get_db
from app.models.models import City, Material, Role, User
from app.models.commerce import WholesaleEvent, WholesaleFavorite, WholesaleRequest
from app.schemas.commerce import AccessInput, ModerationInput, WholesaleInput, WholesaleOut
from app.security.auth import OrderAccessActor, get_current_admin_user, get_current_order_actor, get_current_user

router = APIRouter(prefix="/wholesale-requests", tags=["wholesale"])
PARTNER_ROLES = {"driver", "supplier", "equipment_owner", "water_septic_partner"}


def today():
    return datetime.now(ZoneInfo(settings.PAYMENT_REPORT_TIMEZONE)).date()


async def board_user(actor: OrderAccessActor = Depends(get_current_order_actor)):
    user = actor.user if isinstance(actor, OrderAccessActor) else actor
    if user is None:
        raise HTTPException(403, "Раздел доступен только партнёрам")
    role = user.role.name
    if role in {"admin", "logist"}:
        return user
    if role not in PARTNER_ROLES or not user.wholesale_access_enabled:
        raise HTTPException(403, "Доступ к оптовым заявкам выдаёт администратор")
    return user


def is_staff(user):
    return user.role.name in {"admin", "logist"}


def visible(request):
    return request.status == "published" and request.ends_on >= today()


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
    request.moderation_reason = reason
    db.add(WholesaleEvent(request_id=request.id, actor_id=user.id if user else None, status=status, reason=reason))


async def serialize(db, request, user):
    result = WholesaleOut.model_validate(request)
    result.is_owner = request.author_id == user.id
    result.is_favorite = bool(await db.scalar(select(WholesaleFavorite.enabled).where(
        WholesaleFavorite.request_id == request.id, WholesaleFavorite.user_id == user.id)))
    return result


@router.get("/access")
async def access(user: User = Depends(get_current_user)):
    return {"enabled": is_staff(user) or (user.role.name in PARTNER_ROLES and user.wholesale_access_enabled), "can_moderate": user.role.name == "admin"}


@router.get("/partners")
async def partners(q: str = "", user: User = Depends(get_current_admin_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(User, Role.name).join(Role).where(
        Role.name.in_(PARTNER_ROLES), User.is_deleted.is_(False),
        (User.username.ilike(f"%{q}%") | User.display_name.ilike(f"%{q}%")),
    ).order_by(User.username).limit(200))).all()
    return [{"id": u.id, "name": u.display_name or u.username, "role": role, "enabled": u.wholesale_access_enabled, "active": u.is_active} for u, role in rows]


@router.patch("/partners/{user_id}")
async def partner_access(user_id: UUID, payload: AccessInput, admin: User = Depends(get_current_admin_user), db: AsyncSession = Depends(get_db)):
    partner = await db.scalar(select(User).join(Role).where(User.id == user_id, Role.name.in_(PARTNER_ROLES), User.is_deleted.is_(False)))
    if not partner:
        raise HTTPException(404, "Партнёр не найден")
    partner.wholesale_access_enabled = payload.enabled
    await db.commit()
    return {"enabled": payload.enabled}


@router.get("")
async def feed(view: str = Query("all", pattern="^(all|mine|favorites|moderation)$"), q: str = "", city_id: UUID | None = None,
               starts_on: str | None = None, ends_on: str | None = None, page: int = Query(1, ge=1),
               page_size: int = Query(20, ge=1, le=100), user: User = Depends(board_user), db: AsyncSession = Depends(get_db)):
    from datetime import date
    conditions = []
    if view == "mine":
        conditions.append(WholesaleRequest.author_id == user.id)
    elif view == "moderation":
        if user.role.name != "admin":
            raise HTTPException(403, "Только администратор")
        conditions.append(WholesaleRequest.status.in_(["pending_moderation", "published", "hidden", "rejected"]))
    else:
        conditions.extend([WholesaleRequest.status == "published", WholesaleRequest.ends_on >= today()])
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
async def create(payload: WholesaleInput, user: User = Depends(board_user), db: AsyncSession = Depends(get_db)):
    await validate_input(db, payload)
    request = WholesaleRequest(**payload.model_dump(), author_id=user.id)
    db.add(request)
    await db.flush()
    change_status(db, request, user, "draft")
    await db.commit()
    await db.refresh(request)
    return await serialize(db, request, user)


@router.get("/{request_id}", response_model=WholesaleOut)
async def detail(request_id: UUID, user: User = Depends(board_user), db: AsyncSession = Depends(get_db)):
    request = await get_request(db, request_id)
    if request.author_id != user.id and not is_staff(user) and not visible(request):
        raise HTTPException(404, "Заявка недоступна")
    return await serialize(db, request, user)


@router.put("/{request_id}", response_model=WholesaleOut)
async def edit(request_id: UUID, payload: WholesaleInput, user: User = Depends(board_user), db: AsyncSession = Depends(get_db)):
    request = await get_request(db, request_id, lock=True)
    if request.author_id != user.id:
        raise HTTPException(403, "Можно изменять только свои заявки")
    await validate_input(db, payload)
    for key, value in payload.model_dump().items():
        setattr(request, key, value)
    change_status(db, request, user, "pending_moderation" if request.status == "published" else "draft")
    await db.commit()
    await db.refresh(request)
    return await serialize(db, request, user)


@router.post("/{request_id}/submit", response_model=WholesaleOut)
async def submit(request_id: UUID, user: User = Depends(board_user), db: AsyncSession = Depends(get_db)):
    request = await get_request(db, request_id, lock=True)
    if request.author_id != user.id:
        raise HTTPException(403, "Можно отправить только свою заявку")
    if request.status not in {"draft", "rejected"} or request.ends_on < today():
        raise HTTPException(409, "Сначала отредактируйте заявку и проверьте сроки")
    change_status(db, request, user, "pending_moderation")
    await db.commit()
    await db.refresh(request)
    return await serialize(db, request, user)


@router.post("/{request_id}/close", response_model=WholesaleOut)
async def close(request_id: UUID, user: User = Depends(board_user), db: AsyncSession = Depends(get_db)):
    request = await get_request(db, request_id, lock=True)
    if request.author_id != user.id and user.role.name != "admin":
        raise HTTPException(403, "Нет доступа")
    change_status(db, request, user, "closed")
    await db.commit()
    await db.refresh(request)
    return await serialize(db, request, user)


@router.post("/{request_id}/moderate", response_model=WholesaleOut)
async def moderate(request_id: UUID, payload: ModerationInput, user: User = Depends(get_current_admin_user), db: AsyncSession = Depends(get_db)):
    request = await get_request(db, request_id, lock=True)
    if payload.action == "publish" and (request.status not in {"pending_moderation", "hidden"} or request.ends_on < today()):
        raise HTTPException(409, "Заявка не готова к публикации")
    if payload.action != "publish" and not (payload.reason or "").strip():
        raise HTTPException(422, "Укажите причину")
    change_status(db, request, user, {"publish": "published", "reject": "rejected", "hide": "hidden"}[payload.action], payload.reason)
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
    if request.author_id != user.id and user.role.name != "admin":
        raise HTTPException(403, "Нет доступа")
    rows = (await db.scalars(select(WholesaleEvent).where(WholesaleEvent.request_id == request_id).order_by(WholesaleEvent.created_at))).all()
    return [{"status": r.status, "reason": r.reason, "created_at": r.created_at} for r in rows]
