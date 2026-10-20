"""Refund unit/integration coverage. Disposable PostgreSQL + mocked YooKassa only."""
import asyncio
from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import select, update, func, delete

from app.core.config import settings
from app.models.commerce import Payment, PaymentEvent, PaymentQuote, Refund
from app.models.models import Client, Order
from app.security.jwt import create_access_token
from app.services import payments, refunds
from tests.test_sprint24_api import create_actor


@pytest_asyncio.fixture
async def case(session_factory, monkeypatch):
    for key, value in {
        "PAYMENTS_ENABLED": True, "YOOKASSA_SHOP_ID": "refund-test",
        "YOOKASSA_SECRET_KEY": "fake-test-only", "PAYMENT_TEST_MODE": True,
        "YOOKASSA_API_BASE_URL": "https://example.invalid/v3",
        "PAYMENT_RETURN_URL": "https://example.invalid/app",
        "PAYMENT_RECEIPTS_ENABLED": True, "PAYMENT_RECEIPT_VAT_CODE": 1,
    }.items():
        monkeypatch.setattr(settings, key, value)
    async with session_factory() as db:
        actor, headers = await create_actor(db, "logist")
        client = Client(name="Refund QA", email=f"{uuid4().hex}@example.invalid")
        db.add(client); await db.flush()
        order = Order(client_id=client.id, total_amount=100, delivery_cost=23.45, status="driver_assigned")
        db.add(order); await db.flush()
        quote = PaymentQuote(order_id=order.id, version=1, amount=Decimal("123.45"), items=[], confirmed_by=actor.id)
        db.add(quote); await db.flush()
        payment = Payment(id=uuid4(), order_id=order.id, client_id=client.id, quote_id=quote.id,
                          amount=Decimal("123.45"), currency="RUB", status="succeeded",
                          provider_id=uuid4().hex, idempotence_key=uuid4().hex,
                          paid_at=payments.now(), reconciliation_status="matched",
                          request_body={"receipt": {"customer": {"email": client.email}, "items": [
                              {"description": "Песок", "quantity": "1.000", "amount": {"value": "100.00", "currency": "RUB"},
                               "payment_mode": "full_prepayment", "payment_subject": "commodity", "vat_code": 1},
                              {"description": "Доставка", "quantity": "1.000", "amount": {"value": "23.45", "currency": "RUB"},
                               "payment_mode": "full_prepayment", "payment_subject": "service", "vat_code": 1}]}})
        db.add(payment); await db.commit()
        buyer = {"Authorization": "Bearer " + create_access_token({"sub": client.email, "role": "client", "client_id": str(client.id)})}
    state = SimpleNamespace(order=order, payment=payment, headers=headers, buyer=buyer, actor=actor,
                            calls=[], objects={}, keys={}, offline=False, timeout=False, status="succeeded",
                            returned=Decimal("0"), refund_status="succeeded")

    async def provider(method, path, body=None, key=None):
        state.calls.append((method, path, body, key))
        if state.offline:
            raise payments.ProviderError()
        if path == f"/payments/{payment.provider_id}" and method == "GET":
            return dict(id=payment.provider_id, status=state.status, amount={"value": "123.45", "currency": "RUB"},
                        recipient={"account_id": "refund-test"}, test=True,
                        metadata={"order_id": str(order.id), "local_payment_id": str(payment.id)},
                        refunded_amount={"value": str(state.returned), "currency": "RUB"})
        if method == "POST" and path == "/refunds":
            assert key
            if key not in state.keys:
                obj = dict(id=uuid4().hex, payment_id=payment.provider_id, status=state.refund_status, amount=body["amount"])
                state.objects[obj["id"]] = obj
                state.keys[key] = obj
                if obj["status"] == "succeeded":
                    state.returned += Decimal(body["amount"]["value"])
            if state.timeout:
                state.timeout = False
                raise payments.ProviderError()
            return state.keys[key]
        if method == "GET" and path.startswith("/refunds/"):
            return state.objects[path.rsplit("/", 1)[1]]
        if method == "POST" and path.endswith("/cancel"):
            state.status = "canceled"
            return dict(id=payment.provider_id, status="canceled", amount={"value": "123.45", "currency": "RUB"},
                        recipient={"account_id": "refund-test"}, test=True,
                        metadata={"order_id": str(order.id), "local_payment_id": str(payment.id)})
        raise AssertionError((method, path))
    monkeypatch.setattr(payments, "provider", provider)
    try:
        yield state
    finally:
        # Cancellation creates real inbox/outbox rows. Keep later notification
        # tests independent of this fixture's backlog (and never touch other orders).
        from app.models.models import PushDelivery, UserNotification
        async with session_factory() as db:
            for model in (PushDelivery, UserNotification):
                await db.execute(delete(model).where(model.payload["order_id"].astext == str(order.id)))
            await db.commit()


async def enqueue_manual(client, case, amount="30.00", request_id=None, reason="Частичный возврат"):
    return await client.post(f"/api/v1/payments/{case.payment.id}/refund", headers=case.headers,
                             json={"amount": amount, "reason": reason, "request_id": str(request_id or uuid4())})


async def run_job(session_factory, job_id, *, due=False):
    async with session_factory() as db:
        if due:
            await db.execute(update(Refund).where(Refund.id == UUID(str(job_id)))
                             .values(next_attempt_at=payments.now() - timedelta(seconds=1)))
            await db.commit()
        await refunds.process(db, UUID(str(job_id)))


@pytest.mark.asyncio
async def test_cancel_commits_with_provider_offline_and_survives_restart(client, session_factory, case):
    case.offline = True
    response = await client.patch(f"/api/v1/clients/me/orders/{case.order.id}/cancel", headers=case.buyer,
                                  json={"reason": "Планы изменились"})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "cancelled"
    assert not case.calls  # absolutely no provider I/O in cancellation
    repeat = await client.patch(f"/api/v1/clients/me/orders/{case.order.id}/cancel", headers=case.buyer, json={})
    assert repeat.status_code == 200, repeat.text
    async with session_factory() as db:
        payment = await db.get(Payment, case.payment.id)
        assert payment.auto_refund_requested
        jobs = (await db.scalars(select(Refund).where(Refund.payment_id == payment.id))).all()
        assert len(jobs) == 1 and jobs[0].status == "queued"
        job_id = jobs[0].id
    await run_job(session_factory, job_id)
    case.offline = False
    await run_job(session_factory, job_id, due=True)
    async with session_factory() as db:
        assert (await db.get(Refund, job_id)).status == "succeeded"
        payment = await db.get(Payment, case.payment.id)
        assert payment.status == "succeeded"
        assert (await refunds.balances(db, payment))["refunded_amount"] == "123.45"


@pytest.mark.asyncio
async def test_late_payment_refunds_only_marked_cancellation(client, session_factory, case):
    async with session_factory() as db:
        payment = await db.get(Payment, case.payment.id)
        payment.status = "pending"
        await db.commit()
    response = await client.patch(f"/api/v1/clients/me/orders/{case.order.id}/cancel", headers=case.buyer, json={})
    assert response.status_code == 200, response.text
    async with session_factory() as db:
        assert await db.scalar(select(func.count()).select_from(Refund).where(Refund.payment_id == case.payment.id)) == 0
        await payments.sync_payment(db, case.payment.id)
        row = await db.scalar(select(Refund).where(Refund.payment_id == case.payment.id))
        assert row.status == "queued" and row.origin == "automatic"
    await run_job(session_factory, row.id)
    assert case.returned == Decimal("123.45")


@pytest.mark.asyncio
async def test_legacy_cancellation_does_not_start_new_refund(session_factory, case):
    async with session_factory() as db:
        order = await db.get(Order, case.order.id); order.status = "cancelled"
        await db.commit()
        await payments.sync_payment(db, case.payment.id)
        assert await db.scalar(select(Refund.id).where(Refund.payment_id == case.payment.id)) is None
        assert (await db.get(Payment, case.payment.id)).needs_review


@pytest.mark.asyncio
async def test_partial_then_full_remaining_with_stable_request_id(client, session_factory, case):
    request_id = uuid4()
    response = await enqueue_manual(client, case, request_id=request_id)
    assert response.status_code == 202, response.text
    job_id = response.json()["id"]
    assert response.json()["status"] == "queued"
    repeated = await enqueue_manual(client, case, request_id=request_id)
    assert repeated.json()["id"] == job_id
    assert not case.calls
    await run_job(session_factory, job_id)
    repeated = await enqueue_manual(client, case, request_id=request_id)
    assert repeated.json()["status"] == "succeeded"
    detail = (await client.get(f"/api/v1/payments/{case.payment.id}", headers=case.headers)).json()
    assert detail["status"] == "succeeded" and detail["refund_status"] == "partial"
    assert detail["refunded_amount"] == "30.00" and detail["refundable_amount"] == "93.45"
    response = await enqueue_manual(client, case, amount="93.45")
    assert response.status_code == 202, response.text
    await run_job(session_factory, response.json()["id"])
    assert case.returned == Decimal("123.45")
    async with session_factory() as db:
        payment = await db.get(Payment, case.payment.id)
        payment.needs_review = True
        await db.commit()
        await payments.sync_payment(db, payment.id)
        assert not payment.needs_review  # full authenticated reconciliation clears stale warning
    posts = [c[2] for c in case.calls if c[:2] == ("POST", "/refunds")]
    assert len(posts) == 2
    for body in posts:
        assert sum(Decimal(i["amount"]["value"]) for i in body["receipt"]["items"]) == Decimal(body["amount"]["value"])
    for description, total in [("Песок", Decimal("100")), ("Доставка", Decimal("23.45"))]:
        assert sum(Decimal(i["amount"]["value"]) for body in posts for i in body["receipt"]["items"] if i["description"] == description) == total


@pytest.mark.asyncio
async def test_unknown_post_reuses_body_key_and_does_not_double_refund(client, session_factory, case):
    response = await enqueue_manual(client, case)
    case.timeout = True
    job_id = response.json()["id"]
    await run_job(session_factory, job_id)
    async with session_factory() as db:
        assert (await db.get(Refund, UUID(job_id))).status == "unknown"
    await run_job(session_factory, job_id, due=True)
    posts = [c for c in case.calls if c[:2] == ("POST", "/refunds")]
    assert len(posts) == 2 and posts[0][2:] == posts[1][2:]
    assert len(case.keys) == 1 and case.returned == Decimal("30.00")


@pytest.mark.asyncio
async def test_expired_unknown_operation_reserves_balance_without_post(client, session_factory, case):
    response = await enqueue_manual(client, case)
    async with session_factory() as db:
        row = await db.get(Refund, UUID(response.json()["id"]))
        row.status = "unknown"; row.first_attempt_at = payments.now() - timedelta(hours=25)
        await db.commit()
    await run_job(session_factory, row.id, due=True)
    assert not [c for c in case.calls if c[0] == "POST"]
    async with session_factory() as db:
        assert (await db.get(Refund, row.id)).status == "manual_review"
        assert (await refunds.balances(db, await db.get(Payment, case.payment.id)))["reserved_refund_amount"] == "30.00"
    assert (await enqueue_manual(client, case)).status_code == 409


@pytest.mark.asyncio
async def test_concurrent_requests_reserve_once(client, session_factory, case):
    results = await asyncio.gather(enqueue_manual(client, case, amount="100"), enqueue_manual(client, case, amount="100"))
    assert sorted(r.status_code for r in results) == [202, 409], [r.text for r in results]
    async with session_factory() as db:
        payment = await db.get(Payment, case.payment.id)
        balance = await refunds.balances(db, payment)
        assert balance["reserved_refund_amount"] == "100.00" and balance["refundable_amount"] == "23.45"


@pytest.mark.asyncio
async def test_manual_partial_then_cancel_completes_remaining(client, session_factory, case):
    response = await enqueue_manual(client, case)
    cancel = await client.patch(f"/api/v1/clients/me/orders/{case.order.id}/cancel", headers=case.buyer, json={})
    assert cancel.status_code == 200, cancel.text
    await run_job(session_factory, response.json()["id"])
    async with session_factory() as db:
        automatic = await db.scalar(select(Refund).where(Refund.payment_id == case.payment.id, Refund.origin == "automatic"))
        assert automatic.amount == Decimal("93.45") and automatic.status == "queued"
    await run_job(session_factory, automatic.id)
    assert case.returned == Decimal("123.45")


@pytest.mark.asyncio
async def test_duplicate_external_partial_webhook_preserves_payment_status(client, session_factory, case):
    obj = {"id": uuid4().hex, "status": "succeeded", "payment_id": case.payment.provider_id,
           "amount": {"value": "10.00", "currency": "RUB"}}
    case.objects[obj["id"]] = obj; case.returned = Decimal("10")
    for _ in range(2):
        response = await client.post("/api/v1/webhooks/yookassa", json={"event": "refund.succeeded", "object": obj})
        assert response.status_code == 200, response.text
    async with session_factory() as db:
        payment = await db.get(Payment, case.payment.id)
        assert payment.status == "succeeded" and payment.refund_status == "partial"
        assert payment.needs_review  # external receipt allocation is unknown
        assert (await refunds.balances(db, payment))["refunded_amount"] == "10.00"
        assert await db.scalar(select(func.count()).select_from(PaymentEvent).where(
            PaymentEvent.payment_id == payment.id, PaymentEvent.event_type == "refund_succeeded")) == 1
    # Unknown receipt allocation must be reviewed, never copied from a full receipt.
    assert (await enqueue_manual(client, case)).status_code == 409


@pytest.mark.asyncio
async def test_webhook_recovers_accepted_timeout_by_same_key(client, session_factory, case):
    response = await enqueue_manual(client, case)
    case.timeout = True
    await run_job(session_factory, response.json()["id"])
    obj = next(iter(case.objects.values()))
    for _ in range(2):
        response = await client.post("/api/v1/webhooks/yookassa", json={"event": "refund.succeeded", "object": obj})
        assert response.status_code == 200, response.text
    async with session_factory() as db:
        rows = (await db.scalars(select(Refund).where(Refund.payment_id == case.payment.id))).all()
        assert len(rows) == 1 and rows[0].status == "succeeded"
    assert case.returned == Decimal("30")


@pytest.mark.asyncio
@pytest.mark.parametrize("amount,expected", [("124", 409), ("0", 422), ("0.50", 422), ("123.00", 422), ("1.001", 422)])
async def test_amount_validation(client, case, amount, expected):
    assert (await enqueue_manual(client, case, amount=amount)).status_code == expected


@pytest.mark.asyncio
async def test_permissions_reason_and_request_payload(client, case):
    response = await client.post(f"/api/v1/payments/{case.payment.id}/refund", headers=case.buyer,
                                 json={"reason": "Возврат", "request_id": str(uuid4())})
    assert response.status_code in (401, 403)
    assert (await enqueue_manual(client, case, reason="  ")).status_code == 422
    request_id = uuid4()
    assert (await enqueue_manual(client, case, request_id=request_id)).status_code == 202
    assert (await enqueue_manual(client, case, request_id=request_id, amount="31")).status_code == 409


@pytest.mark.asyncio
async def test_cancel_boundary_and_atomic_rollback(client, session_factory, case, monkeypatch):
    async with session_factory() as db:
        order = await db.get(Order, case.order.id); order.status = "loading"; await db.commit()
    response = await client.patch(f"/api/v1/clients/me/orders/{case.order.id}/cancel", headers=case.buyer, json={})
    assert response.status_code == 409
    async with session_factory() as db:
        assert not (await db.get(Payment, case.payment.id)).auto_refund_requested
        order = await db.get(Order, case.order.id); order.status = "driver_assigned"; await db.commit()
    original = refunds.mark_cancellation
    async def broken(db, order):
        await original(db, order)
        raise HTTPException(503, "DB transaction aborted")
    monkeypatch.setattr(refunds, "mark_cancellation", broken)
    response = await client.patch(f"/api/v1/clients/me/orders/{case.order.id}/cancel", headers=case.buyer, json={})
    assert response.status_code == 503
    async with session_factory() as db:
        assert (await db.get(Order, case.order.id)).status == "driver_assigned"
        assert not (await db.get(Payment, case.payment.id)).auto_refund_requested
        assert await db.scalar(select(Refund.id).where(Refund.payment_id == case.payment.id)) is None


@pytest.mark.asyncio
async def test_waiting_capture_voids_authorization_without_refund(session_factory, case):
    async with session_factory() as db:
        payment = await db.get(Payment, case.payment.id)
        payment.status = "pending"; payment.auto_refund_requested = True
        payment.cancel_idempotence_key = uuid4().hex
        await db.commit()
        case.status = "waiting_for_capture"
        await payments.sync_payment(db, case.payment.id)
        assert (await db.get(Payment, case.payment.id)).status == "canceled"
        assert await db.scalar(select(Refund.id).where(Refund.payment_id == case.payment.id)) is None
    assert not [c for c in case.calls if c[1] == "/refunds"]


@pytest.mark.asyncio
async def test_worker_drains_durable_refund_queue(client, session_factory, case, monkeypatch):
    from app.services import commerce_worker
    response = await enqueue_manual(client, case)
    monkeypatch.setattr(commerce_worker, "AsyncSessionLocal", session_factory)
    await commerce_worker.tick()
    async with session_factory() as db:
        assert (await db.get(Refund, UUID(response.json()["id"]))).status == "succeeded"


def test_receipt_allocation_rounding_and_complete_remainder():
    original = {"customer": {"email": "qa@example.invalid"}, "items": [
        {"description": str(j), "quantity": "1.000", "amount": {"value": "1.00", "currency": "RUB"},
         "payment_mode": "full_prepayment", "payment_subject": "commodity", "vat_code": 1}
        for j in range(3)]}
    first = refunds.allocate_receipt(original, Decimal("1.00"), [])
    assert sum(Decimal(i["amount"]["value"]) for i in first["items"]) == 1
    final = refunds.allocate_receipt(original, Decimal("2.00"), [SimpleNamespace(request_body={"receipt": first})])
    for i in range(3):
        assert sum(Decimal(r["amount"]["value"]) for receipt in [first, final] for r in receipt["items"] if r["description"] == str(i)) == 1


@pytest.mark.asyncio
async def test_definitive_refund_failure_does_not_revert_cancellation(client, session_factory, case, monkeypatch):
    cancel = await client.patch(f"/api/v1/clients/me/orders/{case.order.id}/cancel", headers=case.buyer, json={})
    assert cancel.status_code == 200
    provider = payments.provider
    async def reject(method, path, body=None, key=None):
        if path == "/refunds":
            raise payments.ProviderError(definitive=True)
        return await provider(method, path, body, key)
    monkeypatch.setattr(payments, "provider", reject)
    async with session_factory() as db:
        row = await db.scalar(select(Refund).where(Refund.payment_id == case.payment.id))
    await run_job(session_factory, row.id)
    async with session_factory() as db:
        payment = await db.get(Payment, case.payment.id)
        assert (await db.get(Order, case.order.id)).status == "cancelled"
        assert (await db.get(Refund, row.id)).status == "failed"
        assert payment.needs_review
        await refunds.ensure_automatic(db, payment, await db.get(Order, case.order.id))
        assert await db.scalar(select(func.count()).select_from(Refund).where(Refund.payment_id == payment.id)) == 1


@pytest.mark.asyncio
async def test_known_pending_refund_error_keeps_reservation(client, session_factory, case, monkeypatch):
    case.refund_status = "pending"
    response = await enqueue_manual(client, case)
    await run_job(session_factory, response.json()["id"])
    provider = payments.provider
    async def failed_get(method, path, body=None, key=None):
        if path.startswith("/refunds/"):
            raise payments.ProviderError(definitive=True)
        return await provider(method, path, body, key)
    monkeypatch.setattr(payments, "provider", failed_get)
    await run_job(session_factory, response.json()["id"], due=True)
    async with session_factory() as db:
        row = await db.get(Refund, UUID(response.json()["id"]))
        assert row.status == "unknown"
        assert (await refunds.balances(db, await db.get(Payment, case.payment.id)))["reserved_refund_amount"] == "30.00"
    assert (await enqueue_manual(client, case)).status_code == 409


@pytest.mark.asyncio
async def test_concurrent_workers_only_send_once(client, session_factory, case):
    response = await enqueue_manual(client, case)
    await asyncio.gather(run_job(session_factory, response.json()["id"]), run_job(session_factory, response.json()["id"]))
    assert len([c for c in case.calls if c[:2] == ("POST", "/refunds")]) == 1
    assert case.returned == Decimal("30.00")


@pytest.mark.asyncio
async def test_forged_refund_webhook_is_rejected(client, session_factory, case):
    obj = {"id": uuid4().hex, "status": "succeeded", "payment_id": "another-payment",
           "amount": {"value": "10.00", "currency": "RUB"}}
    case.objects[obj["id"]] = obj
    response = await client.post("/api/v1/webhooks/yookassa", json={
        "event": "refund.succeeded", "object": {**obj, "payment_id": case.payment.provider_id}})
    assert response.status_code == 409
    async with session_factory() as db:
        assert await db.scalar(select(Refund.id).where(Refund.payment_id == case.payment.id)) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("status,automatic", [("driver_assigned", True), ("heading_to_pickup", False)])
async def test_logist_archive_refund_policy(client, session_factory, case, status, automatic):
    async with session_factory() as db:
        order = await db.get(Order, case.order.id); order.status = status; await db.commit()
    response = await client.delete(f"/api/v1/logist/orders/{case.order.id}", headers=case.headers)
    assert response.status_code == 200, response.text
    async with session_factory() as db:
        payment = await db.get(Payment, case.payment.id)
        assert payment.auto_refund_requested is automatic
        order = await db.get(Order, case.order.id)
        assert order.is_deleted and order.status == "cancelled"
        row = await db.scalar(select(Refund).where(Refund.payment_id == payment.id))
        assert (row is not None) is automatic


@pytest.mark.asyncio
async def test_settlement_after_partial_refund_uses_only_remaining_prepayment(client, session_factory, case, monkeypatch):
    from app.models.commerce import SettlementReceipt
    response = await enqueue_manual(client, case)
    await run_job(session_factory, response.json()["id"])
    provider = payments.provider
    sent = []
    async def with_receipts(method, path, body=None, key=None):
        if method == "POST" and path == "/receipts":
            sent.append(body)
            return {"id": "qa-settlement", "status": "succeeded"}
        return await provider(method, path, body, key)
    monkeypatch.setattr(payments, "provider", with_receipts)
    async with session_factory() as db:
        order = await db.get(Order, case.order.id); order.status = "completed"; await db.commit()
        await payments.sync_payment(db, case.payment.id)
        assert (await db.scalar(select(SettlementReceipt).where(SettlementReceipt.payment_id == case.payment.id))).status == "succeeded"
    assert sent[0]["settlements"][0]["amount"]["value"] == "93.45"
    assert sum(Decimal(i["amount"]["value"]) for i in sent[0]["items"]) == Decimal("93.45")
    assert all(i["payment_mode"] == "full_payment" for i in sent[0]["items"])


@pytest.mark.asyncio
async def test_uncertain_settlement_blocks_refund_until_reconciled(client, session_factory, case):
    from app.models.commerce import SettlementReceipt
    async with session_factory() as db:
        db.add(SettlementReceipt(payment_id=case.payment.id, idempotence_key=uuid4().hex, status="unknown"))
        await db.commit()
    response = await enqueue_manual(client, case)
    assert response.status_code == 409 and "чека зачёта" in response.json()["detail"]
    assert not case.calls


@pytest.mark.asyncio
@pytest.mark.parametrize("order_status", ["driver_accepted", "heading_to_pickup", "arrived_at_pickup"])
@pytest.mark.parametrize("payment_status", ["succeeded", "pending", "waiting_for_capture"])
async def test_late_client_cancel_releases_driver_and_keeps_manual_refund(
    client, session_factory, case, monkeypatch, order_status, payment_status,
):
    from app.models.models import Driver, OrderOffer, UserNotification
    import app.api.clients as clients_api
    monkeypatch.setattr(clients_api, "schedule_driver_order_cancelled_notification", lambda *_: None)
    async with session_factory() as db:
        driver = Driver(name="Late cancellation QA", phone="+" + str(uuid4().int)[:12], status="busy")
        db.add(driver); await db.flush()
        order = await db.get(Order, case.order.id)
        order.status = order_status
        order.driver_id = driver.id
        offer = OrderOffer(order_id=order.id, driver_id=driver.id, status="accepted", offered_at=payments.now())
        db.add(offer); await db.flush()
        order.current_offer_id = offer.id
        payment = await db.get(Payment, case.payment.id)
        payment.status = payment_status
        payment.provider_status = payment_status
        await db.commit()
        snapshot = {column.name: getattr(payment, column.name) for column in Payment.__table__.columns}
        driver_id, offer_id = driver.id, offer.id

    response = await client.patch(f"/api/v1/clients/me/orders/{case.order.id}/cancel",
                                  headers=case.buyer, json={"reason": "Изменились планы"})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "cancelled"
    assert not case.calls
    repeat = await client.patch(f"/api/v1/clients/me/orders/{case.order.id}/cancel",
                                headers=case.buyer, json={})
    assert repeat.status_code == 200, repeat.text
    async with session_factory() as db:
        order = await db.get(Order, case.order.id)
        assert order.driver_id is None and order.current_offer_id is None
        assert order.cancelled_by_type == "client" and order.cancelled_at is not None
        assert (await db.get(Driver, driver_id)).status == "available"
        assert (await db.get(OrderOffer, offer_id)).status == "cancelled"
        payment = await db.get(Payment, case.payment.id)
        assert {column.name: getattr(payment, column.name) for column in Payment.__table__.columns} == snapshot
        assert not payment.auto_refund_requested
        assert await db.scalar(select(Refund.id).where(Refund.payment_id == payment.id)) is None
        notices = (await db.scalars(select(UserNotification).where(
            UserNotification.payload["order_id"].astext == str(order.id)))).all()
        assert any(n.payload.get("refund_mode") == "manual" for n in notices) == (payment_status == "succeeded")
        # A captured/late-success payment must not trigger an automatic refund.
        await payments.sync_payment(db, payment.id)
        assert await db.scalar(select(Refund.id).where(Refund.payment_id == payment.id)) is None
        assert not payment.auto_refund_requested
        notices = (await db.scalars(select(UserNotification).where(
            UserNotification.payload["order_id"].astext == str(order.id),
            UserNotification.user_id == case.actor.id,
        ))).all()
        assert len(notices) == 1
        assert notices[0].body == (f"Заказ #{str(order.id)[-6:].upper()} отменен клиентом после выезда машины. "
                                   "Требуется ручное решение по возврату средств!")

    manual = await enqueue_manual(client, case, amount="30.00", reason="Возврат с удержанием подачи")
    assert manual.status_code == 202, manual.text
    await run_job(session_factory, manual.json()["id"])
    async with session_factory() as db:
        payment = await db.get(Payment, case.payment.id)
        ledger = await refunds.balances(db, payment)
        assert ledger["refunded_amount"] == "30.00"
        assert ledger["refundable_amount"] == "93.45"
        assert ledger["reserved_refund_amount"] == "0.00"
        rows = (await db.scalars(select(Refund).where(Refund.payment_id == payment.id))).all()
        assert len(rows) == 1 and rows[0].origin == "manual"
        assert not payment.auto_refund_requested


@pytest.mark.asyncio
@pytest.mark.parametrize("order_status", ["loading", "heading_to_client", "delivered", "completed"])
async def test_client_cancel_refused_from_loading(client, session_factory, case, order_status):
    async with session_factory() as db:
        order = await db.get(Order, case.order.id); order.status = order_status; await db.commit()
    response = await client.patch(f"/api/v1/clients/me/orders/{case.order.id}/cancel",
                                  headers=case.buyer, json={})
    assert response.status_code == 409
    async with session_factory() as db:
        assert (await db.get(Order, case.order.id)).status == order_status
        assert not (await db.get(Payment, case.payment.id)).auto_refund_requested
        assert await db.scalar(select(Refund.id).where(Refund.payment_id == case.payment.id)) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("order_status", ["new", "pending"])
async def test_legacy_early_client_cancel_still_enqueues_full_refund(client, session_factory, case, order_status):
    async with session_factory() as db:
        order = await db.get(Order, case.order.id); order.status = order_status; await db.commit()
    response = await client.patch(f"/api/v1/clients/me/orders/{case.order.id}/cancel",
                                  headers=case.buyer, json={})
    assert response.status_code == 200, response.text
    async with session_factory() as db:
        payment = await db.get(Payment, case.payment.id)
        assert payment.auto_refund_requested
        row = await db.scalar(select(Refund).where(Refund.payment_id == payment.id))
        assert row.status == "queued" and row.amount == payment.amount


@pytest.mark.asyncio
async def test_logist_refund_attention_includes_unarchived_old_order_and_exact_balance(client, session_factory, case):
    from app.models.models import City
    async with session_factory() as db:
        order = await db.get(Order, case.order.id)
        order.status = "cancelled"
        order.cancelled_by_type = "client"
        order.created_at = payments.now() - timedelta(days=100)
        order.city_id = (await db.scalar(select(City).where(City.code == "tyumen"))).id
        city_id = order.city_id
        # More than a regular page of newer archive rows must not hide this one.
        db.add_all([Order(client_id=order.client_id, city_id=city_id, status="cancelled",
                          total_amount=1, is_deleted=True) for _ in range(25)])
        other_city = City(name=uuid4().hex, code=uuid4().hex, region="QA",
                          center_lat=50, center_lon=50, map_zoom=10,
                          min_lat=49, max_lat=51, min_lon=49, max_lon=51, is_active=True)
        db.add(other_city); await db.commit()
        other_city_id = other_city.id

    async def fetch(**params):
        return await client.get("/api/v1/logist/orders", headers=case.headers,
                                params={**params, "city_id": str(city_id)})
    response = await fetch(attention_only="true")
    assert response.status_code == 200, response.text
    row = next(r for r in response.json() if r["id"] == str(case.order.id))
    assert row["requires_manual_refund"] and Decimal(row["refundable_amount"]) == Decimal("123.45")
    archive = await fetch(archive="true", date=payments.now().date().isoformat())
    assert archive.status_code == 200, archive.text
    assert archive.json()[0]["id"] == str(case.order.id)
    assert not archive.json()[0]["is_deleted"]
    scoped = await client.get("/api/v1/logist/orders", headers=case.headers,
                              params={"attention_only": "true", "city_id": str(other_city_id)})
    assert scoped.json() == []
    forbidden = await client.get("/api/v1/logist/orders?attention_only=true", headers=case.buyer)
    assert forbidden.status_code in (401, 403)

    refund = await enqueue_manual(client, case, amount="30")
    assert refund.status_code == 202
    response = await fetch(attention_only="true")
    assert Decimal(response.json()[0]["refundable_amount"]) == Decimal("93.45")
    await run_job(session_factory, refund.json()["id"])
    response = await fetch(attention_only="true")
    assert Decimal(response.json()[0]["refundable_amount"]) == Decimal("93.45")
    rest = await enqueue_manual(client, case, amount="93.45")
    assert rest.status_code == 202
    assert (await fetch(attention_only="true")).json() == []
    await run_job(session_factory, rest.json()["id"])
    assert (await fetch(attention_only="true")).json() == []
    # Payment remains succeeded after a full refund, but must not leave a badge.
    async with session_factory() as db:
        assert (await db.get(Payment, case.payment.id)).status == "succeeded"

@pytest.mark.asyncio
@pytest.mark.parametrize("role, expected", [("admin", 202), ("logist", 202), ("manager", 403), ("driver", 403)])
async def test_refund_creation_staff_roles(client, session_factory, case, role, expected):
    async with session_factory() as db:
        actor, headers = await create_actor(db, role)
        order = await db.get(Order, case.order.id)
        order.status = "cancelled"
        order.cancelled_by_type = "client"
        await db.commit()
    response = await client.post(f"/api/v1/payments/{case.payment.id}/refund", headers=headers,
        json={"amount": "30.00", "reason": "Возврат с удержанием подачи", "request_id": str(uuid4())})
    assert response.status_code == expected, response.text
    async with session_factory() as db:
        row = await db.scalar(select(Refund).where(Refund.payment_id == case.payment.id))
        if expected == 202:
            assert row.status == "queued" and row.origin == "manual" and row.initiated_by == actor.id
            assert row.amount == Decimal("30.00") and row.reason == "Возврат с удержанием подачи"
            assert not (await db.get(Payment, case.payment.id)).auto_refund_requested
        else:
            assert row is None
