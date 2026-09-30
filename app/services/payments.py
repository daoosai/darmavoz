"""Durable, idempotent YooKassa integration. Never log provider bodies or credentials."""
from datetime import UTC, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
import uuid

import httpx
from fastapi import HTTPException
from sqlalchemy import select

from app.core.config import settings
from app.models.models import Client, Order, OrderEvent
from app.models.commerce import Payment, PaymentEvent, PaymentQuote, Refund, SettlementReceipt

ACTIVE = {"creating", "unknown", "pending", "succeeded"}
CANCELED_ORDERS = {"canceled", "cancelled", "driver_cancel", "draft"}


def money(value):
    return Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def now():
    return datetime.now(UTC)


def configured():
    return bool(settings.PAYMENTS_ENABLED and settings.YOOKASSA_SHOP_ID and settings.YOOKASSA_SECRET_KEY
                and settings.YOOKASSA_API_BASE_URL and settings.PAYMENT_RETURN_URL
                and (settings.PAYMENT_TEST_MODE or settings.PAYMENT_RECEIPTS_ENABLED)
                and (not settings.PAYMENT_RECEIPTS_ENABLED or settings.PAYMENT_RECEIPT_VAT_CODE is not None))


def ensure_configured():
    if not configured():
        raise HTTPException(503, "Онлайн-оплата пока не подключена")
    if settings.PAYMENT_RECEIPT_MODE not in {"full_prepayment", "full_payment"}:
        raise HTTPException(503, "Параметры чеков не согласованы")
    if any(urlsplit(url).scheme != "https" for url in (settings.YOOKASSA_API_BASE_URL, settings.PAYMENT_RETURN_URL)):
        raise HTTPException(503, "Адреса платёжной интеграции должны использовать HTTPS")


class ProviderError(Exception):
    def __init__(self, definitive=False):
        self.definitive = definitive


async def provider(method, path, body=None, key=None):
    ensure_configured()
    try:
        async with httpx.AsyncClient(timeout=15, auth=(settings.YOOKASSA_SHOP_ID, settings.YOOKASSA_SECRET_KEY)) as client:
            response = await client.request(method, settings.YOOKASSA_API_BASE_URL.rstrip("/") + path,
                                            json=body, headers={"Idempotence-Key": key} if key else {})
        if response.status_code >= 400:
            raise ProviderError(definitive=response.status_code == 400)
        return response.json()
    except (httpx.HTTPError, ValueError):
        raise ProviderError()


async def locked_order(db, order_id):
    order = await db.scalar(select(Order).where(Order.id == order_id).with_for_update())
    if not order:
        raise HTTPException(404, "Заказ не найден")
    return order


def record(db, payment, event, description, order=None):
    db.add(PaymentEvent(payment_id=payment.id, event_type=event, description=description))
    db.add(OrderEvent(order_id=payment.order_id, status=order.status if order else "payment", event_type=event, description=description))


async def latest_quote(db, order_id):
    return await db.scalar(select(PaymentQuote).where(PaymentQuote.order_id == order_id, PaymentQuote.is_valid.is_(True)).order_by(PaymentQuote.version.desc()).limit(1))


async def payment_for_order(db, order_id):
    return await db.scalar(select(Payment).where(Payment.order_id == order_id).order_by(Payment.created_at.desc(), Payment.id).limit(1))


def return_url(order_id):
    url = urlsplit(settings.PAYMENT_RETURN_URL)
    params = dict(parse_qsl(url.query))
    params["payment_order"] = str(order_id)
    return urlunsplit((url.scheme, url.netloc, url.path, urlencode(params), url.fragment))


def receipt_items(quote, *, mode=None):
    return [{"description": item["description"][:128], "quantity": "1.000",
             "amount": {"value": item["amount"], "currency": "RUB"}, "vat_code": settings.PAYMENT_RECEIPT_VAT_CODE,
             "payment_mode": mode or settings.PAYMENT_RECEIPT_MODE, "payment_subject": item["subject"]}
            for item in quote.items if money(item["amount"]) > 0]


def build_payment_body(payment, quote, email):
    body = {"amount": {"value": str(payment.amount), "currency": "RUB"}, "capture": True,
            "description": f"Заказ #{str(payment.order_id)[-6:].upper()}",
            "metadata": {"order_id": str(payment.order_id), "local_payment_id": str(payment.id)},
            "confirmation": {"type": "redirect", "return_url": return_url(payment.order_id)}}
    if settings.PAYMENT_RECEIPTS_ENABLED:
        if not email:
            raise HTTPException(422, "Укажите электронную почту для чека")
        body["receipt"] = {"customer": {"email": email}, "items": receipt_items(quote)}
        if settings.PAYMENT_RECEIPT_TAX_SYSTEM_CODE:
            body["receipt"]["tax_system_code"] = settings.PAYMENT_RECEIPT_TAX_SYSTEM_CODE
    return body


def validate_payment_object(payment, data):
    try:
        matches = (data["amount"]["currency"] == payment.currency and money(data["amount"]["value"]) == payment.amount
                   and data["recipient"]["account_id"] == settings.YOOKASSA_SHOP_ID
                   and data["metadata"]["order_id"] == str(payment.order_id)
                   and data["metadata"]["local_payment_id"] == str(payment.id)
                   and data["test"] == settings.PAYMENT_TEST_MODE
                   and (payment.provider_id is None or payment.provider_id == data["id"]))
    except (KeyError, TypeError, ValueError, ArithmeticError):
        matches = False
    if not matches:
        raise HTTPException(409, "Данные ЮKassa не совпали с платежом. Требуется сверка")


async def apply_payment(db, payment, data, order):
    validate_payment_object(payment, data)
    status = data["status"]
    if status not in {"pending", "succeeded", "canceled", "waiting_for_capture"}:
        raise HTTPException(409, "Неизвестный статус провайдера")
    if payment.status in {"succeeded", "canceled"} and status != payment.status:
        raise HTTPException(409, "Недопустимый переход статуса")
    payment.provider_id = data["id"]
    payment.provider_status = status
    payment.payment_method = (data.get("payment_method") or {}).get("type")
    payment.receipt_status = data.get("receipt_registration")
    payment.confirmation_url = (data.get("confirmation") or {}).get("confirmation_url") or payment.confirmation_url
    payment.checked_at = now()
    payment.reconciliation_status = "matched"
    if money((data.get("refunded_amount") or {}).get("value", "0")) > 0 and payment.refund_status != "succeeded":
        payment.needs_review = True
        payment.reconciliation_status = "mismatch"
    local = "pending" if status == "waiting_for_capture" else status
    if local != payment.status:
        payment.status = local
        if status == "succeeded":
            payment.paid_at = datetime.fromisoformat(data["captured_at"].replace("Z", "+00:00")) if data.get("captured_at") else now()
            payment.needs_review = bool(payment.needs_review or order.is_deleted or order.status in CANCELED_ORDERS)
            record(db, payment, "payment_succeeded", f"Оплачен заказ: {payment.amount} ₽", order)
        elif status == "canceled":
            reason = (data.get("cancellation_details") or {}).get("reason", "canceled")
            payment.failure_reason = reason[:255]
            record(db, payment, "payment_canceled", "Платёж отменён или отклонён", order)


async def resolve_payment(db, payment, order):
    try:
        if payment.provider_id:
            data = await provider("GET", f"/payments/{payment.provider_id}")
        else:
            # YooKassa remembers idempotence keys for 24 hours. Never replay an uncertain charge after that.
            if now() - payment.created_at > timedelta(hours=23):
                payment.needs_review = True
                payment.reconciliation_status = "manual_review"
                return
            data = await provider("POST", "/payments", payment.request_body, payment.idempotence_key)
        await apply_payment(db, payment, data, order)
    except ProviderError as error:
        payment.checked_at = now()
        payment.reconciliation_status = "error"
        if error.definitive and not payment.provider_id:
            payment.status = "failed"
            payment.failure_reason = "provider_validation"
            record(db, payment, "payment_failed", "Провайдер отклонил создание платежа", order)
        elif not payment.provider_id:
            payment.status = "unknown"
    except HTTPException:
        payment.needs_review = True
        payment.reconciliation_status = "mismatch"
        payment.checked_at = now()


async def create_payment(db, order_id, client, email=None):
    ensure_configured()
    order = await locked_order(db, order_id)
    if order.client_id != client.id:
        raise HTTPException(403, "Нельзя оплатить чужой заказ")
    if order.is_deleted or order.status in CANCELED_ORDERS:
        raise HTTPException(409, "Этот заказ недоступен для оплаты")
    existing = await db.scalar(select(Payment).where(Payment.order_id == order.id, Payment.status.in_(ACTIVE)))
    if existing:
        await db.commit()
        return existing
    quote = await latest_quote(db, order.id)
    if not quote:
        raise HTTPException(409, "Логист ещё не подтвердил стоимость")
    payment = Payment(id=uuid.uuid4(), order_id=order.id, client_id=client.id, quote_id=quote.id, amount=quote.amount,
                      idempotence_key=str(uuid.uuid4()), status="creating", customer_contact={"email": email or client.email})
    payment.request_body = build_payment_body(payment, quote, email or client.email)
    db.add(payment)
    await db.flush()
    record(db, payment, "payment_created", "Создана попытка оплаты", order)
    await db.commit()  # Persist key and exact request BEFORE the network call.
    order = await locked_order(db, order_id)
    payment = await db.get(Payment, payment.id, populate_existing=True)
    await resolve_payment(db, payment, order)
    await db.commit()
    return payment


async def resolve_refund(db, refund, payment, order):
    try:
        if refund.provider_id:
            data = await provider("GET", f"/refunds/{refund.provider_id}")
        else:
            if now() - refund.created_at > timedelta(hours=23):
                payment.needs_review = True
                payment.reconciliation_status = "manual_review"
                return
            body = refund.request_body or {"payment_id": payment.provider_id, "amount": {"value": str(refund.amount), "currency": "RUB"}}
            data = await provider("POST", "/refunds", body, refund.idempotence_key)
        if data.get("payment_id") != payment.provider_id or money(data["amount"]["value"]) != refund.amount or data["amount"]["currency"] != "RUB":
            payment.needs_review = True
            payment.reconciliation_status = "mismatch"
            return
        old = refund.status
        refund.provider_id = data["id"]
        refund.status = data["status"]
        payment.refund_status = refund.status
        if refund.status == "succeeded" and old != "succeeded":
            refund.refunded_at = now()
            payment.needs_review = False
            record(db, payment, "refund_succeeded", f"Возвращено {refund.amount} ₽. Причина: {refund.reason}", order)
    except ProviderError as error:
        refund.status = "failed" if error.definitive else "unknown"
        payment.refund_status = refund.status
        payment.reconciliation_status = "error"


async def import_provider_refund(db, payment, provider_refund_id):
    """Import a full cabinet refund only after authenticated verification."""
    data = await provider("GET", f"/refunds/{provider_refund_id}")
    order = await locked_order(db, payment.order_id)
    payment = await db.get(Payment, payment.id, populate_existing=True)
    if data.get("payment_id") != payment.provider_id or data.get("status") != "succeeded" or data["amount"]["currency"] != "RUB":
        raise HTTPException(409, "Возврат не прошёл сверку")
    amount = money(data["amount"]["value"])
    if amount != payment.amount:
        payment.needs_review = True
        payment.reconciliation_status = "mismatch"
        await db.commit()
        return
    row = await db.scalar(select(Refund).where(Refund.payment_id == payment.id, Refund.provider_id == data["id"]))
    if not row:
        row = await db.scalar(select(Refund).where(Refund.payment_id == payment.id, Refund.status.in_(["creating", "unknown", "pending"])))
    if not row:
        row = Refund(payment_id=payment.id, amount=amount, initiated_by=None, reason="Возврат в кабинете ЮKassa", idempotence_key=str(uuid.uuid4()), request_body={})
        db.add(row)
    if row.status != "succeeded":
        row.provider_id = data["id"]
        row.status = "succeeded"
        row.refunded_at = datetime.fromisoformat(data["created_at"].replace("Z", "+00:00")) if data.get("created_at") else now()
        record(db, payment, "refund_succeeded", f"Подтверждён возврат {amount} ₽. {row.reason}", order)
    payment.refund_status = "succeeded"
    payment.needs_review = False
    payment.reconciliation_status = "matched"
    await db.commit()


async def settlement_receipt(db, payment, order):
    if order.status != "completed" or payment.refund_status in {"creating", "unknown", "pending", "succeeded"}:
        return
    original = payment.request_body.get("receipt")
    if not original or not any(i["payment_mode"] == "full_prepayment" for i in original["items"]):
        return
    receipt = await db.scalar(select(SettlementReceipt).where(SettlementReceipt.payment_id == payment.id))
    if not receipt:
        body = {**original, "items": [{**i, "payment_mode": "full_payment"} for i in original["items"]],
                "payment_id": payment.provider_id, "type": "payment", "send": True,
                "settlements": [{"type": "prepayment", "amount": {"value": str(payment.amount), "currency": "RUB"}}]}
        receipt = SettlementReceipt(payment_id=payment.id, idempotence_key=str(uuid.uuid4()), request_body=body)
        db.add(receipt)
        await db.flush()
        await db.commit()
        await locked_order(db, order.id)
    if receipt.status == "succeeded":
        return
    if not receipt.provider_id and now() - receipt.created_at > timedelta(hours=23):
        receipt.status = "manual_review"
        payment.needs_review = True
        return
    try:
        data = await provider("GET", f"/receipts/{receipt.provider_id}") if receipt.provider_id else await provider("POST", "/receipts", receipt.request_body, receipt.idempotence_key)
        receipt.provider_id = data["id"]
        receipt.status = data["status"]
    except ProviderError:
        receipt.status = "unknown"


async def sync_payment(db, payment_id):
    payment = await db.get(Payment, payment_id)
    if not payment:
        raise HTTPException(404, "Платёж не найден")
    order = await locked_order(db, payment.order_id)
    payment = await db.get(Payment, payment_id, populate_existing=True)
    await resolve_payment(db, payment, order)
    if payment.status == "succeeded":
        refunds = (await db.scalars(select(Refund).where(Refund.payment_id == payment.id, Refund.status.in_(["creating", "unknown", "pending"])))).all()
        for refund in refunds:
            await resolve_refund(db, refund, payment, order)
        if order.is_deleted or order.status in CANCELED_ORDERS:
            payment.needs_review = payment.refund_status != "succeeded"
        await settlement_receipt(db, payment, order)
    await db.commit()
    return payment
