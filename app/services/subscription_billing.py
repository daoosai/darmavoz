"""Durable subscription payments/refunds; provider I/O never trusts redirects/webhook bodies."""
from copy import deepcopy
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4
from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl
from sqlalchemy import select, func, text
from app.core.config import settings
from app.models.subscriptions import SubscriptionPayment, SubscriptionPlan, SubscriptionRefund, AccessGrant, CategoryAccess
from app.services import payments as legacy
from app.services import subscriptions as policy

ACTIVE={"queued","creating","pending","unknown"}
RESERVED=ACTIVE|{"manual_review"}
money=legacy.money


async def create(db,user,plan_id,request_id,email):
    if not await policy.enabled(db):policy.error("SUBSCRIPTIONS_NOT_ENABLED","Подписки пока не включены",409)
    plan=await db.get(SubscriptionPlan,plan_id)
    if not plan or not plan.published or plan.amount is None:
        policy.error("PLAN_NOT_PUBLISHED","Тариф пока не утвержден",409)
    if plan.category not in policy.CATEGORIES or user.role.name not in policy.CATEGORIES[plan.category][1]:
        policy.error("CATEGORY_NOT_ALLOWED","Тариф недоступен для вашего кабинета")
    if plan.test_only and not settings.PAYMENT_TEST_MODE:policy.error("TEST_PLAN_FORBIDDEN","Тестовый тариф недоступен",409)
    legacy.ensure_configured()
    await policy.account_category(db,user.id,plan.category,lock=True)
    old=await db.scalar(select(SubscriptionPayment).where(SubscriptionPayment.request_id==request_id))
    if old:
        if old.account_id!=user.id or old.plan_id!=plan.id:policy.error("IDEMPOTENCY_CONFLICT","Запрос уже использован с другими параметрами",409)
        return old
    active=await db.scalar(select(SubscriptionPayment).where(SubscriptionPayment.account_id==user.id,
        SubscriptionPayment.category==plan.category,SubscriptionPayment.status.in_(RESERVED)))
    if active:
        if active.plan_id!=plan.id:policy.error("PAYMENT_PENDING","Сначала завершите или отмените текущую оплату категории",409)
        return active
    row=SubscriptionPayment(id=uuid4(),account_id=user.id,plan_id=plan.id,category=plan.category,
        months=plan.months,amount=plan.amount,status="queued",request_id=request_id,idempotence_key=uuid4().hex)
    url=urlsplit(settings.PAYMENT_RETURN_URL);query=dict(parse_qsl(url.query));query.update(subscription_payment=str(row.id))
    return_url=urlunsplit((url.scheme,url.netloc,url.path,urlencode(query),url.fragment))
    description=f"Подписка Дармавоз: {policy.CATEGORIES[plan.category][0]}, {plan.months} мес."
    row.body={"amount":{"value":str(money(plan.amount)),"currency":"RUB"},"capture":True,
        "confirmation":{"type":"redirect","return_url":return_url},"description":description,
        "metadata":{"purpose":"subscription","subscription_payment_id":str(row.id),"account_id":str(user.id),"category":plan.category}}
    if settings.PAYMENT_RECEIPTS_ENABLED:
        if not email:policy.error("RECEIPT_EMAIL_REQUIRED","Укажите почту для чека",422)
        row.body["receipt"]={"customer":{"email":email},"items":[{"description":description[:128],"quantity":"1.000",
            "amount":{"value":str(money(plan.amount)),"currency":"RUB"},"vat_code":settings.PAYMENT_RECEIPT_VAT_CODE,
            "payment_mode":"full_payment","payment_subject":"service"}]}
        if settings.PAYMENT_RECEIPT_TAX_SYSTEM_CODE:row.body["receipt"]["tax_system_code"]=settings.PAYMENT_RECEIPT_TAX_SYSTEM_CODE
    db.add(row);policy.audit(db,user.id,user.id,"payment_queued",payment_id=str(row.id),category=row.category,plan_revision=plan.revision)
    await db.flush()
    return row


async def apply_payment(db,row,data):
    previous_error=row.last_error
    try:
        valid=(data["metadata"]["subscription_payment_id"]==str(row.id) and data["metadata"]["purpose"]=="subscription"
            and data["metadata"]["account_id"]==str(row.account_id) and data["metadata"]["category"]==row.category
            and data["amount"]["currency"]=="RUB" and money(data["amount"]["value"])==row.amount
            and data["test"]==settings.PAYMENT_TEST_MODE and data["recipient"]["account_id"]==settings.YOOKASSA_SHOP_ID
            and (not row.provider_id or row.provider_id==data["id"]))
    except (KeyError,ValueError,TypeError,ArithmeticError):valid=False
    if not valid:
        row.status="manual_review";row.last_error="provider_mismatch";return
    status=data.get("status")
    if status not in {"pending","succeeded","canceled","waiting_for_capture"}:
        row.status="manual_review";row.last_error="provider_status_unknown";return
    if row.status in {"succeeded","canceled"} and row.status!=status:
        row.last_error="provider_status_regression";return
    row.provider_id=data["id"];row.confirmation_url=(data.get("confirmation") or {}).get("confirmation_url") or row.confirmation_url
    row.status="pending" if status=="waiting_for_capture" else status;row.last_error=None
    if previous_error=="provider_unavailable" and row.status=="pending":
        from app.services.journey import payment_event
        await payment_event(db,row,"subscription_provider_recovered","pending")
    if status=="succeeded":
        key=f"payment:{row.id}";old=await db.scalar(select(AccessGrant).where(AccessGrant.source_key==key))
        if not old:
            at=policy.now();account=await policy.account_category(db,row.account_id,row.category,lock=True)
            end=await policy.grant_end(db,row.account_id,row.category,at)
            base=max([at,*([end] if end else []),*([account.trial_ends_at] if account.trial_ends_at else [])])
            db.add(AccessGrant(account_id=row.account_id,category=row.category,source="payment",source_key=key,
                starts_at=base,ends_at=policy.add_months(base,row.months)))
            row.paid_at=at
            if end:
                policy.audit(db,None,row.account_id,"subscription_renewed",payment_id=str(row.id),category=row.category)
            policy.audit(db,None,row.account_id,"payment_succeeded",payment_id=str(row.id),category=row.category)
        from app.services.journey import payment_event
        await payment_event(db,row,"subscription_payment_succeeded","succeeded")
    elif row.status=="canceled":
        from app.services.journey import payment_event
        await payment_event(db,row,"subscription_payment_canceled","canceled")


async def balances(db,payment):
    rows=(await db.scalars(select(SubscriptionRefund).where(SubscriptionRefund.payment_id==payment.id))).all()
    returned=sum((x.amount for x in rows if x.status=="succeeded"),Decimal(0))
    reserved=sum((x.amount for x in rows if x.status in RESERVED),Decimal(0))
    return {"refunded_amount":str(money(returned)),"reserved_amount":str(money(reserved)),
        "refundable_amount":str(money(max(Decimal(0),payment.amount-returned-reserved))) if payment.status=="succeeded" else "0.00"}


async def refund(db,user,payment_id,amount,reason,request_id,adjustment=None):
    # Same category lock first, payment second. Each adjustment references only this payment's grant.
    payment=await db.get(SubscriptionPayment,payment_id)
    if not payment:policy.error("PAYMENT_NOT_FOUND","Платеж не найден",404)
    await policy.account_category(db,payment.account_id,payment.category,lock=True)
    payment=await db.scalar(select(SubscriptionPayment).where(SubscriptionPayment.id==payment_id).with_for_update().execution_options(populate_existing=True))
    previous=await db.scalar(select(SubscriptionRefund).where(SubscriptionRefund.request_id==request_id))
    amount=money(amount)
    if previous:
        if previous.payment_id!=payment.id or previous.amount!=amount or previous.reason!=reason or previous.access_adjustment!=adjustment:
            policy.error("IDEMPOTENCY_CONFLICT","Запрос возврата использован с другими параметрами",409)
        return previous
    if payment.status!="succeeded" or not payment.provider_id:policy.error("PAYMENT_NOT_SUCCEEDED","Возврат доступен для успешного платежа",409)
    if await db.scalar(select(SubscriptionRefund.id).where(SubscriptionRefund.payment_id==payment.id,SubscriptionRefund.status.in_(RESERVED))):
        policy.error("REFUND_PENDING","Предыдущий возврат требует завершения или сверки",409)
    if amount<=0 or amount>Decimal((await balances(db,payment))["refundable_amount"]):policy.error("REFUND_BALANCE","Сумма превышает доступный остаток",422)
    await validate_adjustment(db,payment,adjustment)
    row=SubscriptionRefund(payment_id=payment.id,actor_id=user.id,amount=amount,reason=reason,
        request_id=request_id,idempotence_key=uuid4().hex,status="queued",access_adjustment=adjustment)
    row.body={"payment_id":payment.provider_id,"amount":{"value":str(amount),"currency":"RUB"},"description":reason[:250]}
    if payment.body.get("receipt"):
        receipt=deepcopy(payment.body["receipt"]);receipt["items"][0]["amount"]["value"]=str(amount);row.body["receipt"]=receipt
    db.add(row);policy.audit(db,user.id,payment.account_id,"refund_queued",payment_id=str(payment.id),amount=str(amount),decision=adjustment)
    await db.flush();return row


async def apply_refund(db,row,payment,data):
    try:
        valid=(data["payment_id"]==payment.provider_id and data["amount"]["currency"]=="RUB"
            and money(data["amount"]["value"])==row.amount and (not row.provider_id or row.provider_id==data["id"]))
    except (KeyError,TypeError,ValueError,ArithmeticError):valid=False
    if not valid:row.status="manual_review";row.last_error="provider_mismatch";return
    if data.get("status") not in {"pending","succeeded","canceled"}:row.status="manual_review";row.last_error="provider_status_unknown";return
    if row.status in {"succeeded","canceled"} and data["status"]!=row.status:return
    row.provider_id=data["id"];row.status=data["status"];row.last_error=None
    if row.status=="succeeded" and not row.adjustment_applied:
        decision=row.access_adjustment
        if not decision:
            row.access_review_required=True
        else:
            grant=await db.scalar(select(AccessGrant).where(AccessGrant.source_key==f"payment:{payment.id}").with_for_update())
            if not grant:row.access_review_required=True;return
            if decision["action"]=="revoke":grant.revoked=True
            elif decision["action"]=="shorten":
                from datetime import datetime
                end=datetime.fromisoformat(decision["ends_at"].replace("Z","+00:00"))
                if not grant.starts_at<end<=grant.ends_at:row.access_review_required=True;return
                grant.ends_at=end
            row.adjustment_applied=True;row.access_review_required=False
            policy.audit(db,row.actor_id,payment.account_id,"refund_access_applied",refund_id=str(row.id),payment_id=str(payment.id),decision=decision)


async def process(db,kind,job_id):
    model=SubscriptionPayment if kind=="payment" else SubscriptionRefund
    job=await db.get(model,job_id)
    if not job or job.status not in ACTIVE:return
    payment=job if kind=="payment" else await db.get(SubscriptionPayment,job.payment_id)
    await policy.account_category(db,payment.account_id,payment.category,lock=True)
    job=await db.scalar(select(model).where(model.id==job_id).with_for_update().execution_options(populate_existing=True))
    if job.status not in ACTIVE:return
    if not job.provider_id and policy.now()-job.created_at>timedelta(hours=23):
        job.status="manual_review";job.last_error="idempotency_window_expired";await db.commit();return
    path="/payments" if kind=="payment" else "/refunds"
    job.attempts+=1
    try:
        data=await legacy.provider("GET",f"{path}/{job.provider_id}") if job.provider_id else await legacy.provider("POST",path,job.body,job.idempotence_key)
        if kind=="payment":await apply_payment(db,job,data)
        else:await apply_refund(db,job,payment,data)
    except legacy.ProviderError as exc:
        job.status="failed" if exc.definitive and not job.provider_id else "unknown" if not job.provider_id else "pending"
        job.last_error="provider_validation" if exc.definitive else "provider_unavailable"
    if kind=="payment" and job.last_error=="provider_unavailable":
        from app.services.journey import payment_event
        await payment_event(db,job,"subscription_provider_error","pending")
    if kind=="payment" and job.status=="failed":
        from app.services.journey import payment_event
        await payment_event(db,job,"subscription_payment_failed","failed")
    job.next_attempt_at=policy.now()+timedelta(seconds=min(300,5*2**min(job.attempts,6)))
    await db.commit()


async def tick(factory):
    if not legacy.configured():return
    for kind,model in [("payment",SubscriptionPayment),("refund",SubscriptionRefund)]:
        async with factory() as db:
            ids=(await db.scalars(select(model.id).where(model.status.in_(ACTIVE),or_due(model.next_attempt_at)).order_by(model.created_at).limit(10))).all()
        for job_id in ids:
            async with factory() as db:
                if await db.scalar(text("select pg_try_advisory_xact_lock(hashtext(:key))"),{"key":"subscription:"+str(job_id)}):await process(db,kind,job_id)


def or_due(column):
    from sqlalchemy import or_
    return or_(column.is_(None),column<=policy.now())


async def handle_webhook(db,event,obj):
    """Return True for subscription events, after retrieving authoritative provider state."""
    from uuid import UUID,uuid5,NAMESPACE_URL
    if event.startswith("payment."):
        row=await db.scalar(select(SubscriptionPayment).where(SubscriptionPayment.provider_id==obj.get("id")))
        if not row:
            try:local_id=UUID(obj.get("metadata",{}).get("subscription_payment_id",""))
            except (ValueError,TypeError):return False
            row=await db.get(SubscriptionPayment,local_id)
        if not row:return False
        await policy.account_category(db,row.account_id,row.category,lock=True)
        row=await db.scalar(select(SubscriptionPayment).where(SubscriptionPayment.id==row.id).with_for_update().execution_options(populate_existing=True))
        # Never accept a forged object/metadata as evidence of payment.
        data=await legacy.provider("GET","/payments/"+str(row.provider_id or obj["id"]))
        if (data.get("metadata") or {}).get("subscription_payment_id")!=str(row.id):return True
        await apply_payment(db,row,data);await db.commit();return True
    if event=="refund.succeeded":
        payment=await db.scalar(select(SubscriptionPayment).where(SubscriptionPayment.provider_id==obj.get("payment_id")))
        if not payment:return False
        await policy.account_category(db,payment.account_id,payment.category,lock=True)
        data=await legacy.provider("GET","/refunds/"+str(obj["id"]))
        if data.get("payment_id")!=payment.provider_id:return True
        row=await db.scalar(select(SubscriptionRefund).where(SubscriptionRefund.provider_id==data["id"]).with_for_update())
        if not row:
            # A webhook may race the initial POST commit. Do not duplicate a queued operation.
            pending=(await db.scalars(select(SubscriptionRefund).where(SubscriptionRefund.payment_id==payment.id,
                SubscriptionRefund.status.in_(RESERVED),SubscriptionRefund.provider_id.is_(None)).with_for_update())).all()
            if pending:
                policy.error("REFUND_RECONCILING","Повторите уведомление после сверки возврата",503)
            if data.get("amount",{}).get("currency")!="RUB":return True
            amount=money(data["amount"]["value"])
            if amount<=0:return True
            row=SubscriptionRefund(payment_id=payment.id,actor_id=None,amount=amount,reason="Возврат из кабинета платежного сервиса",
                request_id=uuid5(NAMESPACE_URL,"s26-external-refund:"+data["id"]),idempotence_key="external:"+data["id"],
                provider_id=data["id"],status="pending",body={},access_review_required=True)
            db.add(row);await db.flush()
            policy.audit(db,None,payment.account_id,"external_refund_imported",payment_id=str(payment.id),refund_id=str(row.id))
        await apply_refund(db,row,payment,data);await db.commit();return True
    return False


async def validate_adjustment(db,payment,adjustment):
    if adjustment is None:return
    if adjustment.get("action") not in {"keep","revoke","shorten"}:
        policy.error("INVALID_ACCESS_DECISION","Укажите решение по доступу",422)
    allowed={"action","ends_at"} if adjustment["action"]=="shorten" else {"action"}
    if set(adjustment)-allowed:policy.error("INVALID_ACCESS_DECISION","Недопустимые поля решения",422)
    if adjustment["action"]=="shorten":
        from datetime import datetime
        try:end=datetime.fromisoformat(adjustment["ends_at"].replace("Z","+00:00"))
        except (ValueError,KeyError,TypeError):policy.error("INVALID_ACCESS_DECISION","Укажите дату окончания доступа",422)
        grant=await db.scalar(select(AccessGrant).where(AccessGrant.source_key==f"payment:{payment.id}"))
        if not end.tzinfo or not grant or not grant.starts_at<end<=grant.ends_at:
            policy.error("INVALID_ACCESS_DECISION","Новая дата должна входить в период этого платежа",422)


async def decide_refund_access(db,user,refund_id,adjustment,reason):
    row=await db.get(SubscriptionRefund,refund_id)
    if not row:policy.error("REFUND_NOT_FOUND","Возврат не найден",404)
    payment=await db.get(SubscriptionPayment,row.payment_id)
    await policy.account_category(db,payment.account_id,payment.category,lock=True)
    row=await db.scalar(select(SubscriptionRefund).where(SubscriptionRefund.id==refund_id).with_for_update().execution_options(populate_existing=True))
    if row.status!="succeeded":policy.error("REFUND_NOT_SUCCEEDED","Сначала дождитесь подтверждения возврата",409)
    if row.adjustment_applied:
        if row.access_adjustment==adjustment:return row
        policy.error("ACCESS_DECISION_EXISTS","Решение по этому возврату уже применено",409)
    await validate_adjustment(db,payment,adjustment)
    row.access_adjustment=adjustment;row.actor_id=user.id
    policy.audit(db,user.id,payment.account_id,"refund_access_decided",refund_id=str(row.id),decision=adjustment,reason=reason)
    await apply_refund(db,row,payment,{"id":row.provider_id,"payment_id":payment.provider_id,"status":"succeeded","amount":{"value":str(row.amount),"currency":"RUB"}})
    await db.flush();return row
