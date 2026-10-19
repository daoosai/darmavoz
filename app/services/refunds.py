"""Refund ledger and durable jobs. Lock order, then payment, then refund rows.

Cancellation only writes intent here; provider I/O is performed after commit by
the worker. Pending/unknown/manual_review operations reserve their entire amount.
"""
from copy import deepcopy
from datetime import timedelta
from decimal import Decimal, ROUND_DOWN
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select

from app.models.commerce import Payment, Refund, SettlementReceipt
from app.services import payments

RESERVED = {"queued", "creating", "unknown", "pending", "manual_review"}
RUNNABLE = {"queued", "creating", "unknown", "pending"}
CANCELLABLE = {"new", "pending", "draft", "created", "searching_driver", "requires_clarification",
               "offered_to_driver", "no_driver_found", "timeout", "driver_assigned"}

# A client can still stop the job before loading, but the operator decides the
# refund amount after the driver has accepted/started travelling.
MANUAL_CANCELLATION_STATUSES = {"driver_accepted", "heading_to_pickup", "arrived_at_pickup"}
CLIENT_CANCELLABLE_STATUSES = CANCELLABLE | MANUAL_CANCELLATION_STATUSES


async def lock_payment(db, payment_id):
    payment = await db.get(Payment, payment_id)
    if not payment:
        raise HTTPException(404, "Платёж не найден")
    order = await payments.locked_order(db, payment.order_id)
    payment = await db.scalar(select(Payment).where(Payment.id == payment_id)
                              .execution_options(populate_existing=True).with_for_update())
    return order, payment


async def balances(db, payment):
    rows = (await db.scalars(select(Refund).where(Refund.payment_id == payment.id))).all()
    returned = sum((r.amount for r in rows if r.status == "succeeded"), Decimal("0"))
    reserved = sum((r.amount for r in rows if r.status in RESERVED), Decimal("0"))
    available = max(Decimal("0"), payment.amount - returned - reserved) if payment.status == "succeeded" else Decimal("0")
    return {"refunded_amount": str(payments.money(returned)),
            "reserved_refund_amount": str(payments.money(reserved)),
            "refundable_amount": str(payments.money(available))}


async def aggregate(db, payment):
    await db.flush()
    rows = (await db.scalars(select(Refund).where(Refund.payment_id == payment.id))).all()
    succeeded = sum((r.amount for r in rows if r.status == "succeeded"), Decimal("0"))
    active = next((r for r in rows if r.status in RESERVED), None)
    if active:
        payment.refund_status = active.status
    elif succeeded >= payment.amount:
        payment.refund_status = "succeeded"
    elif succeeded:
        payment.refund_status = "partial"
    elif rows:
        payment.refund_status = max(rows, key=lambda r: (r.created_at, str(r.id))).status
    else:
        payment.refund_status = None


def allocate_receipt(original, amount, successful):
    """Allocate cents over original receipt positions, preserving subject/VAT/mode.

    Current checkout receipts contain quantity=1.000. Subtract previously returned
    positions before proportional allocation; never copy a full receipt for a part.
    External refunds without receipt allocation require an accountant's review.
    """
    items = deepcopy(original["items"])
    if any(Decimal(i["quantity"]) != 1 for i in items):
        raise HTTPException(409, "Состав чека требует ручной проверки")
    remaining = [payments.money(i["amount"]["value"]) for i in items]
    for row in successful:
        receipt = row.request_body.get("receipt")
        if not receipt:
            raise HTTPException(409, "Внешний возврат требует сверки позиций чека")
        for item in receipt["items"]:
            matches = [j for j, original_item in enumerate(items)
                       if original_item["description"] == item["description"]
                       and original_item["payment_subject"] == item["payment_subject"]]
            if len(matches) != 1:
                raise HTTPException(409, "Позиции чека требуют ручной проверки")
            remaining[matches[0]] -= payments.money(item["amount"]["value"])
    total = sum(remaining)
    if amount > total or any(v < 0 for v in remaining) or total <= 0:
        raise HTTPException(409, "Остаток чека не совпадает с суммой возврата")
    parts = [(amount * v / total).quantize(Decimal(".01"), rounding=ROUND_DOWN) for v in remaining]
    cents = int((amount - sum(parts)) * 100)
    for j in range(len(parts)):
        if cents and parts[j] < remaining[j]:
            parts[j] += Decimal(".01")
            cents -= 1
    result = []
    for item, part in zip(items, parts):
        if part:
            item["amount"]["value"] = str(part)
            result.append(item)
    return {**deepcopy(original), "items": result}


async def enqueue(db, payment, order, *, amount=None, reason, actor_id=None, request_id=None, origin="manual"):
    # Caller owns both row locks. One unresolved operation per payment.
    if request_id:
        existing = await db.scalar(select(Refund).where(Refund.request_id == request_id))
        if existing:
            if (existing.payment_id != payment.id or existing.initiated_by != actor_id
                    or existing.reason != reason or (amount is not None and existing.amount != amount)):
                raise HTTPException(409, "Идентификатор запроса уже использован с другими параметрами")
            return existing
    if payment.status != "succeeded" or not payment.provider_id:
        raise HTTPException(409, "Возврат доступен только для успешного платежа")
    active = await db.scalar(select(Refund).where(Refund.payment_id == payment.id, Refund.status.in_(RESERVED)))
    if active:
        raise HTTPException(409, "Предыдущий возврат ещё не завершён или требует сверки")
    if payment.reconciliation_status in {"mismatch", "manual_review"}:
        raise HTTPException(409, "Сначала устраните расхождение платёжной сверки")
    balance = await balances(db, payment)
    available = Decimal(balance["refundable_amount"])
    amount = payments.money(amount if amount is not None else available)
    if amount <= 0 or amount > available:
        raise HTTPException(409, "Сумма превышает доступный остаток возврата")
    if amount != available and (amount < 1 or available - amount < 1):
        raise HTTPException(422, "Частичный возврат и оставшийся остаток должны быть не меньше 1 ₽")
    body = {"payment_id": payment.provider_id, "amount": {"value": str(amount), "currency": payment.currency},
            "description": reason[:250]}
    original = payment.request_body.get("receipt")
    if original:
        unresolved_settlement = await db.scalar(select(SettlementReceipt.id).where(
            SettlementReceipt.payment_id == payment.id,
            SettlementReceipt.status.in_(["creating", "unknown", "pending", "manual_review"])))
        if unresolved_settlement:
            raise HTTPException(409, "Дождитесь сверки чека зачёта перед возвратом")
        successful = (await db.scalars(select(Refund).where(Refund.payment_id == payment.id, Refund.status == "succeeded"))).all()
        body["receipt"] = allocate_receipt(original, amount, successful)
        settlement = await db.scalar(select(SettlementReceipt).where(
            SettlementReceipt.payment_id == payment.id, SettlementReceipt.status == "succeeded"))
        if settlement:
            body["receipt"]["items"] = [{**i, "payment_mode": "full_payment"} for i in body["receipt"]["items"]]
    row = Refund(id=uuid4(), payment_id=payment.id, amount=amount, initiated_by=actor_id,
                 request_id=request_id, origin=origin, reason=reason, idempotence_key=str(uuid4()),
                 request_body=body, status="queued", attempts=0, next_attempt_at=payments.now())
    db.add(row)
    payment.refund_status = "queued"
    await db.flush()
    payments.record(db, payment, "refund_created",
                    f"Возврат {amount} ₽ поставлен в очередь. Причина: {reason}", order)
    return row


async def ensure_automatic(db, payment, order):
    if not payment.auto_refund_requested or payment.status != "succeeded":
        return
    active = await db.scalar(select(Refund).where(Refund.payment_id == payment.id, Refund.status.in_(RESERVED)))
    if active:
        return
    balance = await balances(db, payment)
    if Decimal(balance["refundable_amount"]) <= 0:
        return
    failed_auto = await db.scalar(select(Refund.id).where(
        Refund.payment_id == payment.id, Refund.origin == "automatic", Refund.status.in_(["failed", "canceled"])))
    if failed_auto:
        payment.needs_review = True
        return
    try:
        await enqueue(db, payment, order, reason="Возврат при отмене заказа", origin="automatic")
    except HTTPException:
        # Cancellation must still commit. Persist review state rather than losing intent.
        was_review = payment.needs_review
        payment.needs_review = True
        if was_review:
            return
        payments.record(db, payment, "refund_review_required", "Автовозврат требует проверки финансового модуля", order)


async def mark_cancellation(db, order):
    """Called inside the cancellation transaction, even when YooKassa is offline."""
    rows = (await db.scalars(select(Payment).where(Payment.order_id == order.id)
                            .with_for_update())).all()
    for payment in rows:
        payment.auto_refund_requested = True
        payment.cancel_idempotence_key = payment.cancel_idempotence_key or str(uuid4())
        await ensure_automatic(db, payment, order)


async def apply_result(db, row, payment, order, data):
    try:
        matches = (data["payment_id"] == payment.provider_id
                   and payments.money(data["amount"]["value"]) == row.amount
                   and data["amount"]["currency"] == payment.currency
                   and data["status"] in {"pending", "succeeded", "canceled"}
                   and (row.provider_id is None or row.provider_id == data["id"]))
    except (KeyError, TypeError, ValueError, ArithmeticError):
        matches = False
    if not matches or (row.status in {"succeeded", "canceled"} and row.status != data.get("status")):
        row.status = "manual_review"
        row.last_error = "provider_mismatch"
        payment.needs_review = True
        payment.reconciliation_status = "mismatch"
        await aggregate(db, payment)
        return
    old = row.status
    row.provider_id = data["id"]
    row.status = data["status"]
    row.last_error = None
    row.next_attempt_at = payments.now() + timedelta(seconds=60)
    if row.status == "succeeded" and old != "succeeded":
        row.refunded_at = payments.now()
        if payment.reconciliation_status == "matched":
            payment.needs_review = False
        payments.record(db, payment, "refund_succeeded", f"Возвращено {row.amount} ₽. Причина: {row.reason}", order)
    if row.status == "canceled" and old != "canceled":
        row.last_error = str((data.get("cancellation_details") or {}).get("reason", "provider_canceled"))[:255]
        payment.needs_review = True
        payments.record(db, payment, "refund_canceled", f"Возврат {row.amount} ₽ отклонён провайдером", order)
    await aggregate(db, payment)


async def resolve(db, row, payment, order):
    if row.status not in RUNNABLE:
        return
    try:
        if row.provider_id:
            data = await payments.provider("GET", f"/refunds/{row.provider_id}")
        else:
            if row.first_attempt_at and payments.now() - row.first_attempt_at > timedelta(hours=23):
                row.status = "manual_review"
                row.last_error = "idempotency_window_expired"
                payment.needs_review = True
                payment.reconciliation_status = "manual_review"
                await aggregate(db, payment)
                return
            data = await payments.provider("POST", "/refunds", row.request_body, row.idempotence_key)
        await apply_result(db, row, payment, order, data)
    except payments.ProviderError as error:
        row.status = "failed" if error.definitive and not row.provider_id else "unknown"
        row.last_error = "provider_validation" if error.definitive else "provider_unavailable"
        row.next_attempt_at = payments.now() + timedelta(seconds=min(3600, 30 * 2 ** min(row.attempts or 0, 7)))
        if row.status == "failed":
            payment.needs_review = True
            payments.record(db, payment, "refund_failed", "Провайдер отклонил возврат. Требуется проверка", order)
        await aggregate(db, payment)


async def process(db, refund_id):
    initial = await db.get(Refund, refund_id)
    if not initial:
        return
    order, payment = await lock_payment(db, initial.payment_id)
    row = await db.scalar(select(Refund).where(Refund.id == refund_id)
                          .execution_options(populate_existing=True).with_for_update())
    if row.status not in RUNNABLE or (row.next_attempt_at and row.next_attempt_at > payments.now()):
        await db.commit()
        return
    if row.status == "queued":
        await payments.resolve_payment(db, payment, order)
        returned = Decimal((await balances(db, payment))["refunded_amount"])
        if (payment.reconciliation_status in {"error", "mismatch", "manual_review"}
                or payment.status != "succeeded" or returned + row.amount > payment.amount):
            row.next_attempt_at = payments.now() + timedelta(seconds=60)
            if payment.reconciliation_status != "error":
                row.status = "manual_review"
                row.last_error = "payment_reconciliation_required"
                payment.needs_review = True
            await aggregate(db, payment)
            await db.commit()
            return
        row.status = "creating"
    # Record first attempt BEFORE network, preserving body/key across restarts.
    row.attempts += 1
    row.first_attempt_at = row.first_attempt_at or payments.now()
    row.next_attempt_at = payments.now() + timedelta(seconds=60)
    await db.commit()
    order, payment = await lock_payment(db, payment.id)
    row = await db.scalar(select(Refund).where(Refund.id == refund_id)
                          .execution_options(populate_existing=True).with_for_update())
    if row.status in RUNNABLE:
        await resolve(db, row, payment, order)
        await ensure_automatic(db, payment, order)
    await db.commit()


async def import_refund(db, payment, provider_refund_id):
    data = await payments.provider("GET", f"/refunds/{provider_refund_id}")
    order, payment = await lock_payment(db, payment.id)
    try:
        amount = payments.money(data["amount"]["value"])
        valid = (data["id"] == provider_refund_id and data["payment_id"] == payment.provider_id
                 and data["status"] == "succeeded" and data["amount"]["currency"] == payment.currency
                 and amount > 0)
    except (KeyError, TypeError, ValueError, ArithmeticError):
        valid = False
    if not valid:
        raise HTTPException(409, "Возврат не прошёл сверку")
    row = await db.scalar(select(Refund).where(Refund.provider_id == provider_refund_id))
    if row and (row.payment_id != payment.id or row.amount != amount):
        raise HTTPException(409, "Возврат не совпадает с локальной операцией")
    if not row:
        # Metadata is not available on YooKassa Refund. Never attach a cabinet
        # refund to an arbitrary local pending operation; replay its saved key first.
        unknown = (await db.scalars(select(Refund).where(
            Refund.payment_id == payment.id, Refund.provider_id.is_(None),
            Refund.status.in_(["creating", "unknown"]))
        )).all()
        for candidate in unknown:
            if candidate.first_attempt_at and payments.now() - candidate.first_attempt_at < timedelta(hours=23):
                # This lookup uses the SAME POST key/body; never creates a new operation.
                await resolve(db, candidate, payment, order)
        row = await db.scalar(select(Refund).where(Refund.provider_id == provider_refund_id))
    if not row:
        total = Decimal((await balances(db, payment))["refunded_amount"])
        if total + amount > payment.amount:
            raise HTTPException(409, "Возврат превышает сумму платежа")
        row = Refund(id=uuid4(), payment_id=payment.id, amount=amount, initiated_by=None,
                     origin="external", reason="Возврат в кабинете ЮKassa",
                     idempotence_key=str(uuid4()), request_body={}, status="external")
        db.add(row)
    await apply_result(db, row, payment, order, data)
    # Only clear a mismatch after authenticated totals match the full local ledger.
    data_payment = await payments.provider("GET", f"/payments/{payment.provider_id}")
    await payments.apply_payment(db, payment, data_payment, order)
    returned = Decimal((await balances(db, payment))["refunded_amount"])
    provider_returned = payments.money((data_payment.get("refunded_amount") or {}).get("value"))
    if returned == provider_returned:
        payment.reconciliation_status = "matched"
        unallocated_receipt = (row.origin == "external" and bool(payment.request_body.get("receipt")) and returned < payment.amount)
        payment.needs_review = (unallocated_receipt or payment.refund_status == "manual_review" or
                                ((order.is_deleted or order.status in payments.CANCELED_ORDERS)
                                 and not payment.auto_refund_requested and returned < payment.amount))
    await ensure_automatic(db, payment, order)
    await db.commit()
