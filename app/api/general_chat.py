"""One subscription-gated room; HTTP cursors reuse the support-screen interaction model."""
from datetime import datetime
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, Query
from pydantic import Field
from sqlalchemy import func, select, text
from app.api.subscriptions import Input
from app.db.database import get_db
from app.models.models import User, Role
from app.models.subscriptions import ChatMember, ChatMessage, ChatAudit, SprintSetting
from app.security.auth import get_current_order_actor
from app.services import subscriptions as policy
from app.services.notification_outbox import enqueue

router=APIRouter(prefix="/api/v1/chat",tags=["general-chat"])

async def chat_user(actor=Depends(get_current_order_actor)):
    if not actor.user:
        policy.error("CHAT_SUBSCRIPTION_REQUIRED","Общий чат доступен участникам с подпиской или пробным периодом. Подключите профессиональную категорию в профиле")
    return actor.user


class MessageInput(Input):
    text: str = Field(min_length=1,max_length=4000)
    request_id: UUID

class ActionInput(Input):
    action: str
    target_id: UUID | None = None
    message_id: int | None = None
    reason: str = Field(min_length=3,max_length=500)
    until: datetime | None = None
    rules: str | None = Field(default=None,max_length=4000)


async def room_lock(db):
    # Serialize commit order so both message and moderation cursors cannot skip an uncommitted lower ID.
    await db.execute(text("select pg_advisory_xact_lock(260026)"))


async def member_access(db,user,write=False):
    cfg=await policy.config(db)
    if not cfg["chat_enabled"]:policy.error("CHAT_NOT_ENABLED","Общий чат пока не включен",409)
    member=await db.get(ChatMember,user.id)
    if user.role.name!="admin":
        if member and (member.banned or member.removed):policy.error("CHAT_BLOCKED","Доступ к чату ограничен модератором")
        if not await policy.chat_access(db,user):
            policy.error("CHAT_SUBSCRIPTION_REQUIRED","Общий чат доступен по подписке. Ваш бесплатный период или срок подписки закончился. Выберите подходящий тариф и оформите подписку.")
        if write and member and member.muted_until and member.muted_until>policy.now():
            policy.error("CHAT_MUTED","Отправка сообщений временно ограничена")
    return member


async def message_out(db,row):
    user=await db.get(User,row.account_id)
    return {"id":row.id,"account_id":row.account_id,"author":(user.display_name if user else None) or "Участник",
        "text":None if row.deleted else row.text,"deleted":row.deleted,"pinned":row.pinned,
        "created_at":row.created_at,"request_id":row.request_id}


@router.get("/messages")
async def messages(after:int=Query(0,ge=0),before:int|None=Query(None,ge=1),after_audit:int=Query(0,ge=0),
    user=Depends(chat_user),db=Depends(get_db)):
    await room_lock(db)
    member=await member_access(db,user)
    q=select(ChatMessage)
    if before:q=q.where(ChatMessage.id<before)
    elif after:q=q.where(ChatMessage.id>after)
    rows=list((await db.scalars(q.order_by(ChatMessage.id.asc() if after and not before else ChatMessage.id.desc()).limit(50))).all())
    if not after or before:rows.reverse()
    changes=(await db.scalars(select(ChatAudit).where(ChatAudit.sequence>after_audit,
        ChatAudit.action.in_(["delete","pin","unpin","rules"])).order_by(ChatAudit.sequence).limit(200))).all()
    latest=await db.scalar(select(func.coalesce(func.max(ChatAudit.sequence),0)))
    public_changes=[{"sequence":x.sequence,"action":x.action,"message_id":x.details.get("message_id")} for x in changes]
    return {"messages":[await message_out(db,x) for x in rows],"changes":public_changes,
        "audit_cursor":changes[-1].sequence if len(changes)==200 else latest,
        "rules":(await policy.config(db))["chat_rules"],"can_moderate":user.role.name=="admin" or bool(member and member.moderator),
        "is_admin":user.role.name=="admin","muted_until":member.muted_until if member else None,
        "pins":[await message_out(db,x) for x in (await db.scalars(select(ChatMessage).where(ChatMessage.pinned.is_(True),ChatMessage.deleted.is_(False)).order_by(ChatMessage.id.desc()).limit(10))).all()]}


@router.post("/messages",status_code=201)
async def send(payload:MessageInput,user=Depends(chat_user),db=Depends(get_db)):
    await room_lock(db);await member_access(db,user,write=True)
    if not payload.text.strip():policy.error("EMPTY_MESSAGE","Введите сообщение",422)
    old=await db.scalar(select(ChatMessage).where(ChatMessage.request_id==payload.request_id))
    if old:
        if old.account_id!=user.id or old.text!=payload.text:policy.error("IDEMPOTENCY_CONFLICT","Запрос уже использован",409)
        return await message_out(db,old)
    # Bound abuse without depending on an untrusted client clock.
    from datetime import timedelta
    count=await db.scalar(select(func.count(ChatMessage.id)).where(ChatMessage.account_id==user.id,ChatMessage.created_at>policy.now()-timedelta(minutes=1)))
    if count>=30:policy.error("CHAT_RATE_LIMIT","Слишком много сообщений. Подождите минуту",429)
    row=ChatMessage(account_id=user.id,request_id=payload.request_id,text=payload.text);db.add(row)
    await db.flush();await db.commit();return await message_out(db,row)


@router.get("/members")
async def members(q:str="",user=Depends(chat_user),db=Depends(get_db)):
    member=await member_access(db,user)
    if user.role.name!="admin" and not (member and member.moderator):policy.error("MODERATION_FORBIDDEN","Нет прав модерации")
    query=select(User).where(User.is_active.is_(True),User.is_deleted.is_(False))
    if q:query=query.where(User.display_name.ilike(f"%{q[:100]}%"))
    rows=(await db.scalars(query.limit(100))).all();result=[]
    for x in rows:
        m=await db.get(ChatMember,x.id)
        result.append({"id":x.id,"name":x.display_name or "Участник", "moderator":bool(m and m.moderator),
            "banned":bool(m and m.banned),"removed":bool(m and m.removed),"muted_until":m.muted_until if m else None})
    return result


@router.post("/moderation")
async def moderate(payload:ActionInput,user=Depends(chat_user),db=Depends(get_db)):
    await room_lock(db);member=await member_access(db,user)
    admin=user.role.name=="admin"
    if not admin and not (member and member.moderator):policy.error("MODERATION_FORBIDDEN","Нет прав модерации")
    if payload.action not in {"delete","pin","unpin","rules","warn","mute","unmute","ban","unban","remove","restore","set_moderator","unset_moderator"}:
        policy.error("INVALID_ACTION","Неизвестное действие",422)
    if payload.action in {"rules","set_moderator","unset_moderator"} and not admin:
        policy.error("ADMIN_REQUIRED","Действие доступно администратору")
    details={}
    if payload.action in {"delete","pin","unpin"}:
        row=await db.get(ChatMessage,payload.message_id)
        if not row:policy.error("MESSAGE_NOT_FOUND","Сообщение не найдено",404)
        if payload.action=="delete":row.deleted=True;row.pinned=False;row.text=""
        else:
            if row.deleted:policy.error("MESSAGE_DELETED","Сообщение удалено",409)
            row.pinned=payload.action=="pin"
        details["message_id"]=row.id
    elif payload.action=="rules":
        cfg=await db.get(SprintSetting,"platform");cfg.value={**cfg.value,"chat_rules":payload.rules or ""}
    else:
        target=await db.get(User,payload.target_id)
        if not target:policy.error("MEMBER_NOT_FOUND","Участник не найден",404)
        role=await db.get(Role,target.role_id)
        if role.name=="admin":policy.error("ADMIN_PROTECTED","Ограничения администратора здесь не изменяются",409)
        m=await db.get(ChatMember,target.id)
        if not m:m=ChatMember(account_id=target.id);db.add(m)
        if not admin and m.moderator:policy.error("ADMIN_REQUIRED","Права модератора изменяет администратор")
        if payload.action=="mute":
            if not payload.until or not payload.until.tzinfo or payload.until<=policy.now():policy.error("INVALID_PERIOD","Укажите будущую дату ограничения",422)
            m.muted_until=payload.until
        if payload.action=="unmute":m.muted_until=None
        if payload.action=="ban":m.banned=True
        if payload.action=="unban":m.banned=False
        if payload.action=="remove":m.removed=True
        if payload.action=="restore":m.removed=False
        if payload.action=="set_moderator":m.moderator=True
        if payload.action=="unset_moderator":m.moderator=False
        if payload.action=="warn":
            await enqueue(db,key=f"chat-warning:{uuid4()}",recipient_type="user",recipient_id=target.id,event_type="chat_warning",
                title="Предупреждение в общем чате",body=payload.reason,payload={"section":"chat"},inbox=True)
        details["until"]=payload.until.isoformat() if payload.until else None
    db.add(ChatAudit(actor_id=user.id,target_id=payload.target_id,action=payload.action,reason=payload.reason,details=details))
    await db.commit();return {"ok":True}


@router.get("/audit")
async def audit(user=Depends(chat_user),db=Depends(get_db)):
    await member_access(db,user)
    if user.role.name!="admin":policy.error("ADMIN_REQUIRED","Журнал доступен администратору")
    return [{"id":x.id,"sequence":x.sequence,"actor_id":x.actor_id,"target_id":x.target_id,"action":x.action,
        "reason":x.reason,"details":x.details,"created_at":x.created_at} for x in (await db.scalars(select(ChatAudit).order_by(ChatAudit.sequence.desc()).limit(200))).all()]
