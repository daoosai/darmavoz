"""Observe correlated requests without retaining request bodies, passwords or tokens."""
import json
import re
import logging
from uuid import UUID, uuid4
from urllib.parse import parse_qs
from app.db.database import get_db
from app.models.models import User, Client
from app.services import journey, subscriptions as policy
from sqlalchemy import select

logger=logging.getLogger(__name__)

async def observe(request,call_next):
    try:
        visitor=UUID(request.headers["x-visitor-id"]);session_id=UUID(request.headers["x-session-id"])
    except (KeyError,ValueError):return await call_next(request)
    if request.url.path.startswith(("/api/v1/telemetry/","/api/v1/admin/","/api/v1/chat/","/api/v1/subscriptions/admin/")):
        return await call_next(request)
    try:attempt=UUID(request.headers["x-attempt-id"])
    except (KeyError,ValueError):attempt=None
    try:city_id=UUID(request.headers.get("x-journey-city-id",""))
    except ValueError:city_id=None
    kind=request.headers.get("x-attempt-kind","navigation")
    if kind not in {"auth","order","subscription","navigation","receipt","review"}:kind="navigation"
    ctx={"visitor_id":visitor,"session_id":session_id,"attempt_id":attempt,"kind":kind,"db_provider":request.app.dependency_overrides.get(get_db,get_db)};token=journey.context.set(ctx);status=500;response=None
    contact=None
    try:
        content=request.headers.get("content-type","")
        length=request.headers.get("content-length","0")
        if request.method=="POST" and length.isdigit() and 0<int(length)<=16000 and ("json" in content or "urlencoded" in content):
            try:
                raw=await request.body()
                payload=json.loads(raw) if "json" in content else {k:v[0] for k,v in parse_qs(raw.decode()).items()}
                candidate=payload.get("phone_number") or payload.get("phone") or payload.get("email") or payload.get("username")
                if isinstance(candidate,str) and ("@" in candidate or re.fullmatch(r"[+\d\s()\-]{5,30}",candidate)):
                    contact=candidate[:254];ctx["contact"]=contact
            except (ValueError,UnicodeDecodeError,AttributeError):pass
        response=await call_next(request);status=response.status_code
        return response
    finally:
        try:
            # Only meaningful correlated actions; polling/profile reads must not keep abandoned attempts alive.
            if request.method not in {"POST","PATCH"} or kind=="navigation":
                if ctx.get("verified_actor"):
                    provider=ctx["db_provider"];generator=provider();db=await anext(generator)
                    try:
                        await journey.link_verified_session(db,session_id,visitor,ctx["verified_actor"])
                        await db.commit()
                    finally:await generator.aclose()
            else:
                provider=request.app.dependency_overrides.get(get_db,get_db);generator=provider();db=await anext(generator)
                try:
                    if (await policy.config(db))["journey_enabled"]:
                        actor=ctx.get("verified_actor")
                        if ctx.get("auth_claims"):
                            claims=ctx["auth_claims"]
                            if claims.get("role")=="client" and claims.get("client_id"):
                                target=await db.get(Client,UUID(claims["client_id"]))
                                if target and not target.is_deleted:actor=("client",target.id)
                            else:
                                target=await db.scalar(select(User).where(User.username==claims.get("sub"),User.is_active.is_(True),User.is_deleted.is_(False)))
                                if target:actor=("user",target.id)
                        if actor is None and request.headers.get("authorization","").startswith("Bearer "):
                            from app.security.auth import get_current_order_actor
                            try:
                                current=await get_current_order_actor(token=request.headers["authorization"][7:],db=db)
                                target=current.client or current.user
                                actor=("client" if current.client else "user",target.id)
                            except Exception:pass
                        state="failed" if status>=400 else "started"
                        event=f"{kind}_failed" if status>=400 else f"{kind}_submitted"
                        if actor and ctx.get("auth_claims") and status<400:event="auth_succeeded";state="succeeded"
                        if ctx.get("order_id") and status<400:event="order_created" if kind=="order" else "order_received" if kind=="receipt" else "order_reviewed";state="succeeded"
                        if ctx.get("payment_id") and status<400:event="subscription_payment_created";state="pending"
                        if status==403 and kind=="subscription":event="subscription_access_denied";state="canceled"
                        code=ctx.get("error_code") or ("VALIDATION_ERROR" if status in {400,422} else "INVALID_CREDENTIALS" if status==401 else "HTTP_"+str(status))
                        if kind=="auth" and contact:
                            await journey.record(db,event_id=uuid4(),session_id=session_id,visitor_id=visitor,attempt_id=attempt,
                                kind=kind,event="auth_contact_submitted",source="server",actor=actor,contact=contact,
                                details={"field":"email" if "@" in contact else "phone"},city_id=city_id)
                        await journey.record(db,event_id=uuid4(),session_id=session_id,visitor_id=visitor,attempt_id=attempt,
                            kind=kind,event=event,source="server",actor=actor,contact=contact,
                            order_id=UUID(ctx["order_id"]) if ctx.get("order_id") else None,
                            payment_id=UUID(ctx["payment_id"]) if ctx.get("payment_id") else None,
                            state=state,details={"error_code":code} if status>=400 else {},city_id=city_id)
                        if kind=="order" and ctx.get("order_id") and status<400:
                            try:parent_id=UUID(request.headers.get("x-cart-attempt-id",""))
                            except ValueError:parent_id=None
                            if parent_id and parent_id!=attempt:
                                from uuid import uuid5,NAMESPACE_URL
                                await journey.record(db,event_id=uuid5(NAMESPACE_URL,f"s26-cart:{parent_id}:{ctx['order_id']}"),
                                    session_id=session_id,visitor_id=visitor,attempt_id=parent_id,kind="order",event="cart_submitted",source="server",actor=actor,state="succeeded",city_id=city_id)
                        await db.commit()
                finally:await generator.aclose()
        except Exception as exc:
            logger.warning("journey_observation_failed type=%s",type(exc).__name__)
        finally:journey.context.reset(token)
