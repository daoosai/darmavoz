"""Privacy-bounded user journey. Client events never prove authentication/payment success."""
import base64
import hashlib
import logging
from contextvars import ContextVar
from datetime import datetime, UTC, timedelta
from uuid import UUID, uuid4
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select, delete, update, func, case
from sqlalchemy.dialects.postgresql import insert
from app.core.config import settings
from app.models.subscriptions import JourneySession, JourneyAttempt, JourneyEvent, JourneyIncident
from app.services import subscriptions as policy

context=ContextVar("s26_journey",default=None)
logger=logging.getLogger(__name__)
CLIENT_EVENTS={"opened","screen_opened","auth_started","auth_submitted","order_started","order_form_changed",
    "subscription_started","subscription_plan_selected","order_submitted","network_error","receipt_started","review_started"}
DETAIL_FIELDS={"screen","field","online","error_code"}


def cipher():
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(("s26-contacts:"+settings.SECRET_KEY).encode()).digest()))


def encrypt_contact(value):return cipher().encrypt(value.strip()[:254].encode()).decode()


def decrypt_contact(value):
    try:return cipher().decrypt(value.encode()).decode() if value else None
    except (InvalidToken,ValueError):return None


def mask_contact(value):
    if not value:return None
    if "@" in value:
        name,domain=value.split("@",1);return name[:1]+"***@"+domain
    return value[:3]+"***"+value[-2:]


def mark_authenticated(data):
    ctx=context.get()
    if ctx is not None:ctx["auth_claims"]={k:data.get(k) for k in ["sub","role","client_id","auth_version"]}


def mark_order(order_id):
    ctx=context.get()
    if ctx is not None:ctx["order_id"]=str(order_id)


def mark_payment(payment_id):
    ctx=context.get()
    if ctx is not None:ctx["payment_id"]=str(payment_id)


def note_error(exc):
    ctx=context.get()
    if ctx is None:return
    detail=getattr(exc,"detail",None)
    code=detail.get("code") if isinstance(detail,dict) else None
    # Only controlled error codes, never user payloads, exception strings or raw bodies.
    import re
    if code and re.fullmatch(r"[A-Z_]{2,64}",str(code)):ctx["error_code"]=code
    elif isinstance(detail,str):
        low=detail.lower()
        if "код" in low and "неверный" in low and ("истек" in low or "истёк" in low):ctx["error_code"]="OTP_INVALID_OR_EXPIRED"
        elif "код" in low and ("истек" in low or "истёк" in low):ctx["error_code"]="OTP_EXPIRED"
        elif "неверный код" in low:ctx["error_code"]="OTP_INVALID"


async def session(db,session_id,visitor_id):
    await db.execute(insert(JourneySession).values(id=session_id,visitor_id=visitor_id).on_conflict_do_nothing())
    row=await db.get(JourneySession,session_id)
    if row.visitor_id!=visitor_id:policy.error("SESSION_CONFLICT","Сессия не принадлежит посетителю",409)
    return row


async def attempt(db,attempt_id,session_id,kind,stage):
    await db.execute(insert(JourneyAttempt).values(id=attempt_id,session_id=session_id,kind=kind,stage=stage,state="started",abandoned=False).on_conflict_do_nothing())
    row=await db.get(JourneyAttempt,attempt_id)
    if row.session_id!=session_id or row.kind!=kind:policy.error("ATTEMPT_CONFLICT","Попытка принадлежит другой сессии",409)
    return row


async def record(db,*,event_id,session_id,visitor_id,event,source,at=None,attempt_id=None,kind=None,
    details=None,actor=None,contact=None,order_id=None,payment_id=None,state=None,city_id=None):
    cfg=await policy.config(db)
    if not cfg["journey_enabled"]:return
    # Idempotence first: replaying an older event must not regress the current attempt.
    if await db.get(JourneyEvent,event_id):return
    at=at or policy.now();received=policy.now()
    if not at.tzinfo:at=at.replace(tzinfo=UTC)
    if at>received+timedelta(minutes=5) or at<received-timedelta(days=7):at=received
    sess=await session(db,session_id,visitor_id)
    from app.models.models import City,Order
    if order_id:
        order=await db.get(Order,order_id)
        if order:city_id=order.city_id
    if city_id and await db.get(City,city_id):
        # Selected market/order city only; never infer location or merge devices.
        if source!="client" or sess.city_id is None or at>=sess.last_at:sess.city_id=city_id
    row=None
    if attempt_id:
        row=await attempt(db,attempt_id,session_id,kind or "navigation",event)
    safe={k:v for k,v in (details or {}).items() if k in DETAIL_FIELDS and isinstance(v,(str,int,bool))}
    safe={k:(v[:120] if isinstance(v,str) else v) for k,v in safe.items()}
    added=await db.scalar(insert(JourneyEvent).values(id=event_id,session_id=session_id,attempt_id=attempt_id,
        event=event,source=source,occurred_at=at,received_at=received,details=safe).on_conflict_do_nothing().returning(JourneyEvent.id))
    if not added:return
    if source!="worker" or state in {"succeeded","failed","canceled"}:sess.last_at=received
    if actor:
        # A shared device's authenticated session may not silently switch identities.
        if sess.actor_id and (sess.actor_id!=actor[1] or sess.actor_type!=actor[0]):
            policy.error("SESSION_ACCOUNT_CHANGED","Начните новую сессию после смены аккаунта",409)
        sess.actor_type,sess.actor_id=actor
    if row:
        if row.state!="succeeded" or state=="succeeded":
            if source!="client" or row.state not in {"failed","canceled","pending"}:
                row.stage=event;row.last_at=received if source!="worker" or state in {"succeeded","failed","canceled"} else row.last_at
        if contact:
            row.contact_cipher=encrypt_contact(contact);row.contact_at=received
        if order_id:row.order_id=order_id
        if payment_id:row.payment_id=payment_id
        if state and source!="client" and (row.state!="succeeded" or state=="succeeded"):
            row.state=state
            if state=="succeeded":
                row.abandoned=False
                await db.execute(update(JourneyIncident).where(JourneyIncident.attempt_id==row.id).values(resolved=True))
        if source!="client" and row.state!="succeeded":
            if state=="failed" or event=="subscription_provider_error":
                await incident(db,row,event,safe.get("error_code") or "TECHNICAL_ERROR")
            elif state=="canceled":
                await incident(db,row,event,"PAYMENT_CANCELED")


async def incident(db,row,event,reason,abandoned=False):
    cfg=await policy.config(db)
    key=f"{row.id}:{'abandoned' if abandoned else event}:{reason}"
    delay=timedelta(minutes=cfg["input_group_minutes"]) if reason in {"OTP_INVALID","VALIDATION_ERROR","INVALID_CREDENTIALS"} else timedelta(0)
    stmt=insert(JourneyIncident).values(id=uuid4(),dedupe_key=key,attempt_id=row.id,event=event,reason=reason,
        count=1,resolved=False,notified=False,next_notify_at=policy.now()+delay)
    await db.execute(stmt.on_conflict_do_update(index_elements=["dedupe_key"],set_={"count":JourneyIncident.count+1,"resolved":False,
        "notified":case((JourneyIncident.resolved.is_(True),False),else_=JourneyIncident.notified),
        "next_notify_at":case((JourneyIncident.resolved.is_(True),policy.now()+delay),else_=JourneyIncident.next_notify_at)}))


async def payment_event(db,payment,event,state):
    rows=list((await db.scalars(select(JourneyAttempt).where(JourneyAttempt.payment_id==payment.id).order_by(JourneyAttempt.last_at.desc(),JourneyAttempt.id))).all())
    if not rows:return
    from uuid import uuid5,NAMESPACE_URL
    sequence=f":{payment.attempts}" if event in {"subscription_provider_error","subscription_provider_recovered"} else ""
    # Preserve the original release event ID; additional retry attempts get their own stable IDs.
    canonical_id=uuid5(NAMESPACE_URL,f"s26:{payment.id}:{event}{sequence}")
    canonical=await db.get(JourneyEvent,canonical_id)
    primary=canonical.attempt_id if canonical else rows[0].id
    details={"error_code":"PAYMENT_CANCELED" if state=="canceled" else payment.last_error or "PROVIDER_REJECTED"} if state in {"failed","canceled"} or event=="subscription_provider_error" else {}
    for row in rows:
        sess=await db.get(JourneySession,row.session_id)
        event_id=canonical_id if row.id==primary else uuid5(NAMESPACE_URL,f"s26:{payment.id}:{row.id}:{event}{sequence}")
        await record(db,event_id=event_id,session_id=sess.id,visitor_id=sess.visitor_id,
            attempt_id=row.id,kind=row.kind,event=event,source="worker",payment_id=payment.id,state=state,details=details)
        if event=="subscription_provider_recovered":
            await db.execute(update(JourneyIncident).where(JourneyIncident.attempt_id==row.id,JourneyIncident.reason=="provider_unavailable").values(resolved=True))
    if event=="subscription_payment_succeeded":
        from app.models.subscriptions import SubscriptionAudit
        renewed=await db.scalar(select(SubscriptionAudit.id).where(SubscriptionAudit.action=="subscription_renewed",
            SubscriptionAudit.details["payment_id"].astext==str(payment.id)).limit(1))
        if renewed:await payment_event(db,payment,"subscription_renewed","succeeded")


async def maintenance(db):
    cfg=await policy.config(db)
    if not cfg["journey_enabled"]:return
    await reconcile_payments(db)
    await reconcile_orders(db)
    await access_expiry(db)
    at=policy.now()
    rows=(await db.scalars(select(JourneyAttempt).where(JourneyAttempt.state.in_(["started","pending"]),JourneyAttempt.abandoned.is_(False))
        .order_by(JourneyAttempt.last_at).limit(300).with_for_update(skip_locked=True))).all()
    for row in rows:
        minutes=cfg["login_idle_minutes"] if row.kind=="auth" else cfg["payment_idle_minutes"] if row.kind=="subscription" else cfg["order_idle_minutes"]
        if row.kind not in {"auth","order","subscription"} or row.last_at>at-timedelta(minutes=minutes):continue
        row.abandoned=True
        # Pending payments remain pending, never become provider failures due to inactivity.
        if cfg["notify_abandoned"]:await incident(db,row,"abandoned","INACTIVITY",abandoned=True)
    await db.execute(update(JourneyAttempt).where(JourneyAttempt.contact_at<at-timedelta(days=cfg["contact_days"])).values(contact_cipher=None,contact_at=None))
    await db.execute(delete(JourneyIncident).where(JourneyIncident.created_at<at-timedelta(days=cfg["event_days"])))
    await db.execute(delete(JourneyEvent).where(JourneyEvent.received_at<at-timedelta(days=cfg["event_days"])))
    stale_ids=select(JourneySession.id).where(JourneySession.last_at<at-timedelta(days=cfg["event_days"]))
    await db.execute(delete(JourneyEvent).where(JourneyEvent.session_id.in_(stale_ids)))
    await db.execute(delete(JourneyAttempt).where(JourneyAttempt.session_id.in_(stale_ids)))
    await db.execute(delete(JourneySession).where(JourneySession.id.in_(stale_ids)))
    # No configured recipient => no unsolicited external messages.
    if not cfg["owner_id"] or not (cfg["notify_push"] or cfg["notify_inapp"]):return
    from app.models.models import User,Role,PushDelivery,UserNotification
    owner=await db.get(User,UUID(cfg["owner_id"]))
    role=await db.get(Role,owner.role_id) if owner else None
    if not owner or not owner.is_active or owner.is_deleted or not role or role.name!="admin":return
    items=(await db.scalars(select(JourneyIncident).where(JourneyIncident.notified.is_(False),JourneyIncident.resolved.is_(False),JourneyIncident.next_notify_at<=at).limit(30).with_for_update(skip_locked=True))).all()
    from app.services.notification_outbox import enqueue
    for item in items:
        event_kind="auth_failed" if item.event.startswith("auth") else "order_failed" if item.event.startswith("order") else "provider_rejected" if "payment" in item.event else "technical_error"
        if item.event=="abandoned":
            if not cfg["notify_abandoned"]:continue
        elif event_kind not in cfg["notify_events"]:continue
        attempt_row=await db.get(JourneyAttempt,item.attempt_id) if item.attempt_id else None
        contact=mask_contact(decrypt_contact(attempt_row.contact_cipher)) if attempt_row else None
        body=f"{item.created_at.isoformat()} · {item.event}. Причина: {item.reason}. Попытка: {str(item.attempt_id or item.id)[-6:]}. Повторов: {item.count}."+(f" Контакт: {contact}." if contact else "")
        payload={"incident_id":str(item.id),"attempt_id":str(item.attempt_id or ""),"section":"journeys","journey_session_id":str(attempt_row.session_id) if attempt_row else "", "path":"/admin/journeys"+("?session="+str(attempt_row.session_id) if attempt_row else "")}
        if cfg["notify_push"]:
            await enqueue(db,key=f"journey:{item.id}",recipient_type="user",recipient_id=owner.id,event_type="journey_problem",
                title="Требуется внимание: путь пользователя",body=body,payload=payload,inbox=cfg["notify_inapp"])
        elif cfg["notify_inapp"]:
            db.add(UserNotification(user_id=owner.id,event_type="journey_problem",title="Требуется внимание: путь пользователя",body=body,payload=payload))
        item.notified=True


async def reconcile_payments(db):
    from app.models.subscriptions import SubscriptionPayment
    rows=(await db.scalars(select(SubscriptionPayment).join(JourneyAttempt,JourneyAttempt.payment_id==SubscriptionPayment.id)
        .where(SubscriptionPayment.status.in_(["succeeded","failed","canceled"]),JourneyAttempt.state.in_(["started","pending"]))
        .limit(100))).all()
    for payment in rows:
        await payment_event(db,payment,"subscription_payment_"+payment.status,payment.status)


async def order_event(db,order,event_id,*,event_status=None,at=None):
    if not (await policy.config(db))["journey_enabled"]:return
    row=await db.scalar(select(JourneyAttempt).where(JourneyAttempt.order_id==order.id,JourneyAttempt.kind=="order").order_by(JourneyAttempt.last_at.desc()).limit(1))
    if not row:return
    sess=await db.get(JourneySession,row.session_id)
    from uuid import uuid5,NAMESPACE_URL
    await record(db,event_id=uuid5(NAMESPACE_URL,"s26-order:"+str(event_id)),session_id=sess.id,visitor_id=sess.visitor_id,
        attempt_id=row.id,kind="order",event=event_status or order.status,source="server",order_id=order.id,state="succeeded",at=at)


async def access_expiry(db):
    from app.models.subscriptions import CategoryAccess,AccessGrant,SubscriptionAudit
    at=policy.now();ends={}
    for model,column in [(CategoryAccess,CategoryAccess.trial_ends_at),(AccessGrant,AccessGrant.ends_at)]:
        query=select(model.account_id,model.category,func.max(column)).where(model.account_id.is_not(None),column<=at).group_by(model.account_id,model.category)
        if model is AccessGrant:query=query.where(AccessGrant.revoked.is_(False))
        for account,category,end in (await db.execute(query)).all():
            key=(account,category);ends[key]=max(end,ends.get(key,end))
    for (account,category),end in ends.items():
        if (await policy.access(db,account,category))["active"]:continue
        key=f"expired:{category}:{end.isoformat()}"
        if await db.scalar(select(SubscriptionAudit.id).where(SubscriptionAudit.account_id==account,
            SubscriptionAudit.action=="subscription_expired",SubscriptionAudit.details["key"].astext==key).limit(1)):continue
        policy.audit(db,None,account,"subscription_expired",category=category,ends_at=end.isoformat(),key=key)
        sess=await db.scalar(select(JourneySession).where(JourneySession.actor_type=="user",JourneySession.actor_id==account).order_by(JourneySession.last_at.desc()).limit(1))
        if sess:
            from uuid import uuid5,NAMESPACE_URL
            await record(db,event_id=uuid5(NAMESPACE_URL,f"s26:{account}:{key}"),session_id=sess.id,visitor_id=sess.visitor_id,
                event="subscription_expired",source="worker",kind="subscription",at=end)


async def auth_delivery_failure(code):
    """Called from a Starlette background mail task; no code/body/provider exception is recorded."""
    ctx=context.get()
    if not ctx or ctx.get("kind")!="auth" or not ctx.get("attempt_id"):return
    generator=ctx["db_provider"]();db=await anext(generator)
    try:
        await record(db,event_id=uuid4(),session_id=ctx["session_id"],visitor_id=ctx["visitor_id"],
            attempt_id=ctx["attempt_id"],kind="auth",event="auth_delivery_failed",source="server",state="failed",
            contact=ctx.get("contact"),details={"error_code":code})
        await db.commit()
    finally:await generator.aclose()


def observe_auth_delivery_failure(code):
    if context.get() is None:return
    try:
        import anyio
        anyio.from_thread.run(auth_delivery_failure,code)
    except Exception as exc:
        logger.warning("auth_delivery_observation_failed type=%s",type(exc).__name__)


def mark_verified_actor(kind,identifier):
    ctx=context.get()
    if ctx is not None:ctx["verified_actor"]=(kind,identifier)


async def link_verified_session(db,session_id,visitor_id,actor):
    if not (await policy.config(db))["journey_enabled"]:return
    sess=await session(db,session_id,visitor_id)
    if sess.actor_id and (sess.actor_type,sess.actor_id)!=actor:
        policy.error("SESSION_ACCOUNT_CHANGED","Начните новую сессию после смены аккаунта",409)
    sess.actor_type,sess.actor_id=actor


async def reconcile_orders(db):
    """One catch-up per creation attempt; later transitions are recorded in the order transaction."""
    from app.models.models import Order,OrderEvent
    ids=(await db.execute(select(JourneyAttempt.id,JourneyAttempt.order_id).where(
        JourneyAttempt.kind=="order",JourneyAttempt.order_id.is_not(None),JourneyAttempt.order_synced.is_(False))
        .order_by(JourneyAttempt.last_at).limit(100))).all()
    statuses={"driver_assigned","driver_accepted","heading_to_pickup","arrived_at_pickup","loading","heading_to_client","delivered","completed","cancelled"}
    for aid,oid in ids:
        # Same lock order as status writes: order first, then journey. No lost status
        # can commit between the catch-up query and marking the attempt synchronized.
        order=await db.scalar(select(Order).where(Order.id==oid).with_for_update())
        attempt_row=await db.scalar(select(JourneyAttempt).where(JourneyAttempt.id==aid).with_for_update())
        if not order or not attempt_row or attempt_row.order_synced:continue
        events=(await db.scalars(select(OrderEvent).where(OrderEvent.order_id==oid,OrderEvent.status.in_(statuses)).order_by(OrderEvent.created_at,OrderEvent.id))).all()
        for event in events:await order_event(db,order,event.id,event_status=event.status,at=event.created_at)
        if events:
            attempt_row.stage=order.status;attempt_row.state="succeeded"
            attempt_row.last_at=max(attempt_row.last_at,events[-1].created_at)
        attempt_row.order_synced=True
