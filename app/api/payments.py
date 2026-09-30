import csv
import io
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.db.database import get_db
from app.models.models import Client, Order, OrderItem, User
from app.models.commerce import Payment, PaymentEvent, PaymentQuote, Refund, SettlementReceipt
from app.schemas.commerce import PaymentInput, QuoteInput, RefundInput
from app.security.auth import OrderAccessActor, get_current_admin_user, get_current_client, get_current_logist_user, get_current_order_actor
from app.services import payments as service

router = APIRouter(tags=["payments"])


async def authorized_order(db, order_id, actor):
    order = await db.get(Order, order_id)
    if not order:
        raise HTTPException(404, "Заказ не найден")
    if actor.client and order.client_id == actor.client.id:
        return order
    if actor.user and actor.user.role.name in {"admin", "logist"}:
        return order
    raise HTTPException(403, "Нет доступа к платежам заказа")


def payment_out(payment):
    fields = ("id", "order_id", "client_id", "amount", "currency", "status", "payment_method", "created_at", "paid_at", "receipt_status", "refund_status", "needs_review", "failure_reason", "checked_at", "reconciliation_status", "provider_id")
    return {key: str(payment.amount) if key == "amount" else getattr(payment, key) for key in fields}


@router.get("/payments/config")
async def config(actor: OrderAccessActor = Depends(get_current_order_actor)):
    return {"enabled": service.configured(), "test_mode": settings.PAYMENT_TEST_MODE,
            "receipts_enabled": settings.PAYMENT_RECEIPTS_ENABLED}


@router.post("/orders/{order_id}/payment-quote")
async def quote(order_id: UUID, payload: QuoteInput, user: User = Depends(get_current_logist_user), db: AsyncSession = Depends(get_db)):
    order = await service.locked_order(db, order_id)
    if order.is_deleted or order.status in service.CANCELED_ORDERS:
        raise HTTPException(409, "Заказ недоступен для оплаты")
    active = await db.scalar(select(Payment.id).where(Payment.order_id == order.id, Payment.status.in_(service.ACTIVE)))
    if active:
        raise HTTPException(409, "Стоимость зафиксирована платёжной попыткой")
    current = await db.scalar(select(PaymentQuote).where(PaymentQuote.order_id == order.id).order_by(PaymentQuote.version.desc()).limit(1))
    items = (await db.scalars(select(OrderItem).where(OrderItem.order_id == order.id).options(selectinload(OrderItem.material)))).all()
    material_description = ", ".join(dict.fromkeys(item.material.name for item in items if item.material)) or "Материалы по заказу"
    positions = [{"description": material_description, "amount": str(payload.material_amount), "subject": "commodity"},
                 {"description": "Доставка по заказу", "amount": str(payload.delivery_amount), "subject": "service"}]
    new = PaymentQuote(order_id=order.id, version=current.version + 1 if current else 1, amount=payload.amount, items=positions, confirmed_by=user.id)
    db.add(new)
    from app.models.models import OrderEvent
    db.add(OrderEvent(order_id=order.id, status=order.status, event_type="payment_quote_confirmed", description=f"Подтверждена сумма оплаты: {payload.amount} ₽"))
    await db.commit()
    return {"amount": str(new.amount), "version": new.version}


@router.get("/orders/{order_id}/payments")
async def order_payments(order_id: UUID, actor: OrderAccessActor = Depends(get_current_order_actor), db: AsyncSession = Depends(get_db)):
    order = await authorized_order(db, order_id, actor)
    quote = await service.latest_quote(db, order_id)
    rows = (await db.scalars(select(Payment).where(Payment.order_id == order_id).order_by(Payment.created_at.desc()))).all()
    return {"order_id": order_id, "quote": {"amount": str(quote.amount), "version": quote.version, "items": quote.items} if quote else None,
            "can_pay": bool(service.configured() and quote and not order.is_deleted and order.status not in service.CANCELED_ORDERS
                            and not any(p.status == "succeeded" for p in rows)),
            "requires_refund_review": any(p.status == "succeeded" and p.refund_status != "succeeded" for p in rows) and (order.is_deleted or order.status in service.CANCELED_ORDERS),
            "items": [payment_out(p) for p in rows]}


@router.post("/orders/{order_id}/payments")
async def pay(order_id: UUID, payload: PaymentInput, client: Client = Depends(get_current_client), db: AsyncSession = Depends(get_db)):
    payment = await service.create_payment(db, order_id, client, payload.email)
    return {**payment_out(payment), "confirmation_url": payment.confirmation_url if payment.status == "pending" else None}


@router.get("/payments/{payment_id}")
async def detail(payment_id: UUID, actor: OrderAccessActor = Depends(get_current_order_actor), db: AsyncSession = Depends(get_db)):
    payment = await db.get(Payment, payment_id)
    if not payment:
        raise HTTPException(404, "Платёж не найден")
    await authorized_order(db, payment.order_id, actor)
    events = (await db.scalars(select(PaymentEvent).where(PaymentEvent.payment_id == payment_id).order_by(PaymentEvent.created_at))).all()
    refunds = (await db.scalars(select(Refund).where(Refund.payment_id == payment_id).order_by(Refund.created_at))).all()
    receipt = await db.scalar(select(SettlementReceipt).where(SettlementReceipt.payment_id == payment_id))
    return {**payment_out(payment), "events": [{"type": e.event_type, "description": e.description, "created_at": e.created_at} for e in events],
            "refunds": [{"id": r.id, "amount": str(r.amount), "reason": r.reason, "status": r.status, "refunded_at": r.refunded_at} for r in refunds],
            "settlement_receipt_status": receipt.status if receipt else None}


@router.post("/payments/{payment_id}/refresh")
async def refresh(payment_id: UUID, actor: OrderAccessActor = Depends(get_current_order_actor), db: AsyncSession = Depends(get_db)):
    payment = await db.get(Payment, payment_id)
    if not payment:
        raise HTTPException(404, "Платёж не найден")
    await authorized_order(db, payment.order_id, actor)
    if payment.checked_at and service.now() - payment.checked_at < timedelta(seconds=10):
        return payment_out(payment)
    return payment_out(await service.sync_payment(db, payment_id))


@router.post("/payments/{payment_id}/refund")
async def refund(payment_id: UUID, payload: RefundInput, admin: User = Depends(get_current_admin_user), db: AsyncSession = Depends(get_db)):
    service.ensure_configured()
    payment = await db.get(Payment, payment_id)
    if not payment:
        raise HTTPException(404, "Платёж не найден")
    order = await service.locked_order(db, payment.order_id)
    payment = await db.get(Payment, payment_id, populate_existing=True)
    if payment.status != "succeeded":
        raise HTTPException(409, "Возврат доступен только для оплаченного заказа")
    existing = await db.scalar(select(Refund).where(Refund.payment_id == payment.id, Refund.status.in_(service.ACTIVE)))
    if existing:
        return {"status": existing.status, "amount": str(existing.amount)}
    row = Refund(payment_id=payment.id, amount=payment.amount, initiated_by=admin.id, reason=payload.reason,
                 idempotence_key=str(uuid4()), status="creating")
    row.request_body = {"payment_id": payment.provider_id, "amount": {"value": str(payment.amount), "currency": "RUB"}}
    if payment.request_body.get("receipt"):
        receipt = dict(payment.request_body["receipt"])
        settlement = await db.scalar(select(SettlementReceipt).where(SettlementReceipt.payment_id == payment.id, SettlementReceipt.status == "succeeded"))
        if settlement:
            receipt["items"] = [{**i, "payment_mode": "full_payment"} for i in receipt["items"]]
        row.request_body["receipt"] = receipt
    db.add(row)
    payment.refund_status = "creating"
    await db.flush()
    service.record(db, payment, "refund_created", f"Запрошен полный возврат: {payload.reason}", order)
    await db.commit()
    order = await service.locked_order(db, payment.order_id)
    await service.resolve_refund(db, row, payment, order)
    await db.commit()
    return {"status": row.status, "amount": str(row.amount)}


@router.post("/webhooks/yookassa")
async def webhook(request: Request, db: AsyncSession = Depends(get_db)):
    if not service.configured():
        raise HTTPException(503, "Платёжная интеграция выключена")
    try:
        body = await request.json()
        event = body.get("event")
        obj = body["object"]
        provider_id = obj["id"]
    except (ValueError, KeyError, TypeError, AttributeError):
        raise HTTPException(400, "Некорректное уведомление")
    if event in {"payment.succeeded", "payment.canceled", "payment.waiting_for_capture"}:
        payment = await db.scalar(select(Payment).where(Payment.provider_id == provider_id))
        if not payment:
            try:
                local_id = UUID(obj.get("metadata", {}).get("local_payment_id", ""))
            except (ValueError, TypeError):
                return {"ok": True}
            payment = await db.get(Payment, local_id)
        if payment:
            # Fetch from authenticated API; the webhook body itself is never authoritative.
            await service.sync_payment(db, payment.id)
            if payment.reconciliation_status == "error":
                raise HTTPException(503, "Повторите доставку уведомления")
    elif event == "refund.succeeded":
        payment = await db.scalar(select(Payment).where(Payment.provider_id == obj.get("payment_id")))
        if payment:
            await service.sync_payment(db, payment.id)
            try:
                await service.import_provider_refund(db, payment, provider_id)
            except service.ProviderError:
                raise HTTPException(503, "Повторите доставку уведомления")
    return {"ok": True}


def period(start, end):
    if start and end and end < start:
        raise HTTPException(422, "Проверьте период")
    zone = ZoneInfo(settings.PAYMENT_REPORT_TIMEZONE)
    return (datetime.combine(start, time.min, zone) if start else None,
            datetime.combine(end + timedelta(days=1), time.min, zone) if end else None)


def filters(start, end, status, method, order_query, date_field):
    lo, hi = period(start, end)
    column = Payment.paid_at if date_field == "paid" else Payment.created_at
    conditions = []
    if lo:
        conditions.append(column >= lo)
    if hi:
        conditions.append(column < hi)
    if status == "refunded":
        conditions.append(Payment.refund_status == "succeeded")
    elif status:
        conditions.append(Payment.status == status)
    if method:
        conditions.append(Payment.payment_method == method)
    if order_query:
        from sqlalchemy import String, cast
        conditions.append(cast(Payment.order_id, String).ilike(f"%{order_query}%"))
    return conditions


@router.get("/finance/payments")
async def ledger(start: date | None = None, end: date | None = None, status: str | None = None, method: str | None = None,
                 order_query: str = "", date_field: str = Query("created", pattern="^(created|paid)$"),
                 page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
                 user: User = Depends(get_current_logist_user), db: AsyncSession = Depends(get_db)):
    conditions = filters(start, end, status, method, order_query, date_field)
    total = await db.scalar(select(func.count()).select_from(Payment).where(*conditions))
    rows = (await db.execute(select(Payment, Client.name).join(Client).where(*conditions).order_by(Payment.created_at.desc(), Payment.id).offset((page - 1) * page_size).limit(page_size))).all()
    return {"items": [{**payment_out(p), "client_name": name} for p, name in rows], "total": total, "page": page,
            "timezone": settings.PAYMENT_REPORT_TIMEZONE}


@router.get("/finance/summary")
async def summary(start: date | None = None, end: date | None = None, status: str | None = None, method: str | None = None,
                  order_query: str = "", user: User = Depends(get_current_logist_user), db: AsyncSession = Depends(get_db)):
    lo, hi = period(start, end)
    paid_conditions = [Payment.status == "succeeded"]
    refund_conditions = [Refund.status == "succeeded"]
    selection = filters(None, None, status, method, order_query, "created")
    paid_conditions.extend(selection)
    refund_conditions.extend(selection)
    if lo:
        paid_conditions.append(Payment.paid_at >= lo)
        refund_conditions.append(Refund.refunded_at >= lo)
    if hi:
        paid_conditions.append(Payment.paid_at < hi)
        refund_conditions.append(Refund.refunded_at < hi)
    paid, count = (await db.execute(select(func.coalesce(func.sum(Payment.amount), 0), func.count()).where(*paid_conditions))).one()
    refunded = await db.scalar(select(func.coalesce(func.sum(Refund.amount), 0)).join(Payment, Refund.payment_id == Payment.id).where(*refund_conditions))
    failed = await db.scalar(select(func.count()).select_from(Payment).where(*filters(start, end, status, method, order_query, "created"), Payment.status.in_(["failed", "canceled"])))
    return {"paid": str(paid), "refunded": str(refunded), "net": str(paid - refunded), "successful_count": count, "failed_count": failed,
            "timezone": settings.PAYMENT_REPORT_TIMEZONE}


def csv_safe(value):
    value = str(value or "")
    return "'" + value if value[:1] in {"=", "+", "-", "@", "\t", "\r"} else value


@router.get("/finance/export")
async def export(start: date | None = None, end: date | None = None, status: str | None = None, method: str | None = None,
                 order_query: str = "", date_field: str = Query("created", pattern="^(created|paid)$"),
                 user: User = Depends(get_current_logist_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Payment, Client.name).join(Client).where(*filters(start, end, status, method, order_query, date_field)).order_by(Payment.created_at.desc()).limit(10001))).all()
    if len(rows) > 10000:
        raise HTTPException(422, "Сузьте период выгрузки до 10 000 операций")
    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow(["Дата создания", "Дата оплаты", "Клиент", "Заказ", "Сумма RUB", "Способ", "Статус", "Возврат", "ЮKassa"])
    for p, name in rows:
        writer.writerow([csv_safe(v) for v in (p.created_at.isoformat(), p.paid_at.isoformat() if p.paid_at else "", name, p.order_id, p.amount, p.payment_method, p.status, p.refund_status, p.provider_id)])
    return Response(output.getvalue().encode("utf-8"), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="payments.csv"'})


@router.post("/finance/reconcile")
async def reconcile(user: User = Depends(get_current_admin_user), db: AsyncSession = Depends(get_db)):
    service.ensure_configured()
    ids = (await db.scalars(select(Payment.id).where(Payment.status.in_(service.ACTIVE)).order_by(Payment.checked_at.asc().nulls_first()).limit(30))).all()
    for payment_id in ids:
        await service.sync_payment(db, payment_id)
    return {"checked": len(ids)}
