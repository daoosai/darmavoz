from datetime import datetime
from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field
from sqlalchemy import select, func, or_
from app.api.subscriptions import Input
from app.db.database import get_db
from app.models.models import Order, PushDelivery
from app.models.subscriptions import JourneySession, JourneyAttempt, JourneyEvent, JourneyIncident, OrderReview
from app.security.auth import get_current_admin_user, get_current_client
from app.services import subscriptions as policy, journey as service

router=APIRouter(prefix="/api/v1",tags=["journeys"])

class EventInput(Input):
    id: UUID
    session_id: UUID
    visitor_id: UUID
    attempt_id: UUID | None = None
    kind: Literal["auth","order","subscription","navigation","receipt","review"] = "navigation"
    event: str = Field(max_length=80)
    occurred_at: datetime
    details: dict = Field(default_factory=dict)

class BatchInput(Input):
    events: list[EventInput] = Field(min_length=1,max_length=30)

class ReviewInput(Input):
    rating: int = Field(ge=1,le=5)
    comment: str | None = Field(default=None,max_length=2000)


@router.post("/telemetry/events")
async def ingest(payload:BatchInput,request:Request,db=Depends(get_db)):
    if not (await policy.config(db))["journey_enabled"]:return {"accepted":[] ,"enabled":False}
    from app.services.redis_client import get_redis
    # Namespace never includes raw contacts/IP. Fail closed if the throttle is unavailable.
    key="s26:events:"+policy.identity_key(request.client.host if request.client else "unknown")
    try:
        redis=get_redis();count=await redis.incr(key)
        if count==1:await redis.expire(key,60)
        if count>120:policy.error("TELEMETRY_RATE_LIMIT","Слишком много событий",429)
    except Exception as exc:
        from fastapi import HTTPException
        if isinstance(exc,HTTPException):raise
        policy.error("TELEMETRY_UNAVAILABLE","Повторите отправку событий позже",503)
    try:city_id=UUID(request.headers.get("x-journey-city-id",""))
    except ValueError:city_id=None
    accepted=[]
    for item in payload.events:
        if item.event not in service.CLIENT_EVENTS:policy.error("EVENT_NOT_ALLOWED","Событие подтверждается сервером",422)
        # Clients cannot inject success, error bodies, contacts or account IDs through metadata.
        if set(item.details)-service.DETAIL_FIELDS:policy.error("EVENT_DETAILS_NOT_ALLOWED","Недопустимые поля события",422)
        allowed={"screen":{"app","login","cart","subscriptions","chat","profile","orders","admin_journeys","review"},
            "field":{"phone","email","address","volume","material","code"},"error_code":{"NETWORK_UNAVAILABLE","FORM_INVALID"}}
        if any(k in item.details and (not isinstance(item.details[k],str) or item.details[k] not in values) for k,values in allowed.items()) or ("online" in item.details and not isinstance(item.details["online"],bool)):
            policy.error("EVENT_DETAILS_NOT_ALLOWED","Недопустимые значения события",422)
        await service.record(db,event_id=item.id,session_id=item.session_id,visitor_id=item.visitor_id,
            attempt_id=item.attempt_id,kind=item.kind,event=item.event,source="client",at=item.occurred_at,details=item.details,city_id=city_id)
        accepted.append(item.id)
    await db.commit();return {"accepted":accepted,"enabled":True}


def attempt_out(row,full=False):
    contact=service.decrypt_contact(row.contact_cipher)
    return {"id":row.id,"kind":row.kind,"stage":row.stage,"state":row.state,"abandoned":row.abandoned,
        "contact":contact if full else service.mask_contact(contact),"has_contact":bool(contact),
        "order_id":row.order_id,"payment_id":row.payment_id,"last_at":row.last_at}


@router.get("/admin/journeys")
async def visitors(start:datetime|None=None,end:datetime|None=None,stage:str|None=None,
    problem:Literal["failed","abandoned"]|None=None,authenticated:bool|None=None,city_id:UUID|None=None,
    page:int=Query(1,ge=1),user=Depends(get_current_admin_user),db=Depends(get_db)):
    if any(x and not x.tzinfo for x in [start,end]) or (start and end and end<start):policy.error("INVALID_PERIOD","Проверьте период и часовой пояс",422)
    filters=[]
    if start:filters.append(JourneySession.last_at>=start)
    if end:filters.append(JourneySession.last_at<=end)
    if authenticated is not None:filters.append(JourneySession.actor_id.is_not(None) if authenticated else JourneySession.actor_id.is_(None))
    if city_id:filters.append(JourneySession.city_id==city_id)
    attempts=select(JourneyAttempt.session_id)
    if stage:filters.append(JourneySession.id.in_(attempts.where(JourneyAttempt.stage==stage)))
    if problem=="failed":
        incident_attempts=select(JourneyIncident.attempt_id).where(JourneyIncident.resolved.is_(False),JourneyIncident.reason!="PAYMENT_CANCELED")
        filters.append(JourneySession.id.in_(attempts.where(or_(JourneyAttempt.state=="failed",JourneyAttempt.id.in_(incident_attempts)))))
    if problem=="abandoned":filters.append(JourneySession.id.in_(attempts.where(JourneyAttempt.abandoned.is_(True))))
    total=await db.scalar(select(func.count()).select_from(JourneySession).where(*filters))
    rows=(await db.scalars(select(JourneySession).where(*filters).order_by(JourneySession.last_at.desc()).offset((page-1)*30).limit(30))).all()
    result=[]
    for row in rows:
        latest=await db.scalar(select(JourneyAttempt).where(JourneyAttempt.session_id==row.id).order_by(JourneyAttempt.last_at.desc()).limit(1))
        result.append({"id":row.id,"visitor_id":row.visitor_id,"actor_type":row.actor_type,"actor_id":row.actor_id,
            "city_id":row.city_id,"last_at":row.last_at,"attempt":attempt_out(latest) if latest else None})
    sessions=select(JourneySession.id).where(*filters)
    attempts_rows=(await db.execute(select(JourneyAttempt.state,JourneyAttempt.abandoned,func.count()).where(JourneyAttempt.session_id.in_(sessions)).group_by(JourneyAttempt.state,JourneyAttempt.abandoned))).all()
    stages=(await db.execute(select(JourneyEvent.event,func.count()).where(JourneyEvent.session_id.in_(sessions)).group_by(JourneyEvent.event))).all()
    # Transitions are counted within a concrete attempt/session, never across different orders.
    ordered=select(JourneyEvent.event.label("next"),func.lag(JourneyEvent.event).over(
        partition_by=func.coalesce(JourneyEvent.attempt_id,JourneyEvent.session_id),
        order_by=(JourneyEvent.occurred_at,JourneyEvent.received_at,JourneyEvent.id)).label("previous")).where(JourneyEvent.session_id.in_(sessions)).subquery()
    transitions=(await db.execute(select(ordered.c.previous,ordered.c.next,func.count()).where(ordered.c.previous.is_not(None)).group_by(ordered.c.previous,ordered.c.next))).all()
    unique=await db.scalar(select(func.count(func.distinct(JourneySession.visitor_id))).where(*filters))
    return {"items":result,"total":total,"page":page,"summary":{"visitors":unique,"sessions":total,
        "attempts":[{"state":state,"abandoned":abandoned,"count":count} for state,abandoned,count in attempts_rows],
        "stages":[{"event":event,"count":count} for event,count in stages],
        "transitions":[{"from":previous,"to":next_,"count":count} for previous,next_,count in transitions]}}


@router.get("/admin/journeys/{session_id}")
async def detail(session_id:UUID,user=Depends(get_current_admin_user),db=Depends(get_db)):
    row=await db.get(JourneySession,session_id)
    if not row:policy.error("JOURNEY_NOT_FOUND","Сессия не найдена",404)
    attempts=(await db.scalars(select(JourneyAttempt).where(JourneyAttempt.session_id==row.id).order_by(JourneyAttempt.last_at))).all()
    events=(await db.scalars(select(JourneyEvent).where(JourneyEvent.session_id==row.id).order_by(JourneyEvent.occurred_at,JourneyEvent.received_at,JourneyEvent.id).limit(1000))).all()
    incidents=(await db.scalars(select(JourneyIncident).where(JourneyIncident.attempt_id.in_([x.id for x in attempts])).order_by(JourneyIncident.created_at))).all()
    notifications=[]
    for item in incidents:
        jobs=(await db.scalars(select(PushDelivery).where(PushDelivery.payload["incident_id"].astext==str(item.id)))).all()
        notifications.append({"id":item.id,"event":item.event,"reason":item.reason,"count":item.count,"resolved":item.resolved,
            "notified":item.notified,"created_at":item.created_at,"deliveries":[{"status":job.status,"attempts":job.attempts} for job in jobs]})
    from app.models.subscriptions import SubscriptionPayment, SubscriptionAudit
    payments=[]
    for aid in [x.payment_id for x in attempts if x.payment_id]:
        p=await db.get(SubscriptionPayment,aid)
        if p:payments.append({"id":p.id,"status":p.status,"amount":str(p.amount),"category":p.category})
    history=[]
    if row.actor_type=="user" and row.actor_id:
        history=[{"action":x.action,"details":x.details,"created_at":x.created_at} for x in (await db.scalars(select(SubscriptionAudit).where(SubscriptionAudit.account_id==row.actor_id).order_by(SubscriptionAudit.created_at.desc()).limit(100))).all()]
    return {"session":{"id":row.id,"visitor_id":row.visitor_id,"actor_type":row.actor_type,"actor_id":row.actor_id,"city_id":row.city_id,"created_at":row.created_at,"last_at":row.last_at},
        "attempts":[attempt_out(x) for x in attempts],"events":[{"id":x.id,"event":x.event,"source":x.source,"attempt_id":x.attempt_id,
        "occurred_at":x.occurred_at,"received_at":x.received_at,"details":x.details} for x in events],"incidents":notifications,"payments":payments,"subscription_history":history}


@router.get("/admin/journey-attempts/{attempt_id}/contact")
async def contact(attempt_id:UUID,user=Depends(get_current_admin_user),db=Depends(get_db)):
    row=await db.get(JourneyAttempt,attempt_id)
    if not row:policy.error("ATTEMPT_NOT_FOUND","Попытка не найдена",404)
    policy.audit(db,user.id,None,"journey_contact_viewed",attempt_id=str(row.id));await db.commit()
    return {"contact":service.decrypt_contact(row.contact_cipher)}


async def own_order(db,order_id,client):
    row=await db.scalar(select(Order).where(Order.id==order_id).with_for_update())
    if not row or row.client_id!=client.id:policy.error("ORDER_NOT_FOUND","Заказ не найден",404)
    return row


@router.get("/client/orders/{order_id}/review")
async def get_review(order_id:UUID,client=Depends(get_current_client),db=Depends(get_db)):
    order=await own_order(db,order_id,client);row=await db.get(OrderReview,order.id)
    return {"can_receive":order.status in {"delivered","completed"},"received_at":row.received_at if row else None,
        "rating":row.rating if row else None,"comment":row.comment if row else None}


@router.post("/client/orders/{order_id}/received")
async def receive(order_id:UUID,client=Depends(get_current_client),db=Depends(get_db)):
    order=await own_order(db,order_id,client)
    if order.status not in {"delivered","completed"}:policy.error("ORDER_NOT_DELIVERED","Подтверждение доступно после доставки",409)
    row=await db.get(OrderReview,order.id)
    if not row:row=OrderReview(order_id=order.id,client_id=client.id);db.add(row)
    await db.commit();service.mark_order(order.id);return {"received_at":row.received_at}


@router.post("/client/orders/{order_id}/review")
async def review(order_id:UUID,payload:ReviewInput,client=Depends(get_current_client),db=Depends(get_db)):
    order=await own_order(db,order_id,client);row=await db.get(OrderReview,order.id)
    if not row:policy.error("RECEIPT_REQUIRED","Сначала подтвердите получение",409)
    if row.rating is not None and (row.rating!=payload.rating or row.comment!=payload.comment):policy.error("REVIEW_EXISTS","Отзыв уже оставлен",409)
    row.rating=payload.rating;row.comment=payload.comment;await db.commit();service.mark_order(order.id)
    return {"rating":row.rating,"comment":row.comment}


@router.get("/admin/order-reviews")
async def reviews(user=Depends(get_current_admin_user),db=Depends(get_db)):
    return [{"order_id":x.order_id,"received_at":x.received_at,"rating":x.rating,"comment":x.comment} for x in (await db.scalars(select(OrderReview).order_by(OrderReview.received_at.desc()).limit(100))).all()]
