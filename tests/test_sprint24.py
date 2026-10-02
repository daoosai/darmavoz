"""Payment invariants with isolated provider/DB doubles: never touch live data."""
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.payments import authorized_order, csv_safe, period
from app.api.wholesale import PARTNER_ROLES, board_user, visible
from app.core.config import settings
from app.models.commerce import Payment, Refund
from app.models.models import Base, Order
from app.schemas.commerce import PaymentInput, QuoteInput, WholesaleInput
from app.services import payments


class FakeDB:
    def __init__(self):
        self.added = []
        self.commit = AsyncMock()
        self.flush = AsyncMock()
        self.get = AsyncMock()
        self.scalar = AsyncMock()

    def add(self, row):
        self.added.append(row)


@pytest.fixture
def config(monkeypatch):
    for name, value in {"PAYMENTS_ENABLED": True, "YOOKASSA_SHOP_ID": "test-shop", "YOOKASSA_SECRET_KEY": "fake-not-a-secret",
                        "YOOKASSA_API_BASE_URL": "https://example.invalid/v3", "PAYMENT_RETURN_URL": "https://example.invalid/app",
                        "PAYMENT_TEST_MODE": True, "PAYMENT_RECEIPTS_ENABLED": True, "PAYMENT_RECEIPT_VAT_CODE": 1,
                        "PAYMENT_RECEIPT_MODE": "full_prepayment"}.items():
        monkeypatch.setattr(settings, name, value)


def payment():
    return Payment(id=uuid4(), order_id=uuid4(), client_id=uuid4(), quote_id=uuid4(), amount=Decimal("123.45"), currency="RUB",
                   status="pending", provider_id="provider-payment", idempotence_key=str(uuid4()), created_at=datetime.now(UTC),
                   request_body={"amount": {"value": "123.45", "currency": "RUB"}})


def provider_data(p, status="succeeded"):
    return {"id": p.provider_id, "status": status, "amount": {"value": str(p.amount), "currency": "RUB"},
            "recipient": {"account_id": "test-shop"}, "metadata": {"order_id": str(p.order_id), "local_payment_id": str(p.id)},
            "test": True, "payment_method": {"type": "sbp"}, "captured_at": datetime.now(UTC).isoformat()}


def order(p, status="created"):
    return SimpleNamespace(id=p.order_id, client_id=p.client_id, status=status, is_deleted=False)


def test_models_are_registered():
    assert {"payments", "payment_quotes", "payment_refunds", "wholesale_requests", "settlement_receipts"}.issubset(Base.metadata.tables)
    assert "wholesale_access_enabled" in Base.metadata.tables["users"].columns
    assert "payment_status" in Order.__mapper__.attrs


@pytest.mark.parametrize("value, expected", [("0.1", "0.10"), ("1.005", "1.01"), ("100.999", "101.00")])
def test_decimal_rounding(value, expected):
    assert str(payments.money(value)) == expected


def test_invalid_quote_and_email_rejected():
    with pytest.raises(ValidationError):
        QuoteInput(amount="10.01", material_amount="10", delivery_amount="0")
    with pytest.raises(ValidationError):
        PaymentInput(email="broken")


def test_quote_decimal_addition():
    q = QuoteInput(amount="0.30", material_amount="0.10", delivery_amount="0.20")
    assert q.amount == Decimal("0.30")


def test_disabled_provider_has_no_network(monkeypatch):
    monkeypatch.setattr(settings, "PAYMENTS_ENABLED", False)
    with pytest.raises(HTTPException) as exc:
        payments.ensure_configured()
    assert exc.value.status_code == 503


def test_live_payments_require_receipts(config, monkeypatch):
    monkeypatch.setattr(settings, "PAYMENT_TEST_MODE", False)
    monkeypatch.setattr(settings, "PAYMENT_RECEIPTS_ENABLED", False)
    assert not payments.configured()


@pytest.mark.parametrize("change", ["amount", "currency", "shop", "order", "test", "id"])
def test_provider_identity_mismatch(config, change):
    p = payment(); data = provider_data(p)
    if change == "amount": data["amount"]["value"] = "1.00"
    if change == "currency": data["amount"]["currency"] = "USD"
    if change == "shop": data["recipient"]["account_id"] = "another-shop"
    if change == "order": data["metadata"]["order_id"] = str(uuid4())
    if change == "test": data["test"] = False
    if change == "id": data["id"] = "another-payment"
    with pytest.raises(HTTPException): payments.validate_payment_object(p, data)


@pytest.mark.asyncio
async def test_duplicate_webhook_does_not_duplicate_history(config):
    db = FakeDB(); p = payment(); o = order(p)
    await payments.apply_payment(db, p, provider_data(p), o)
    assert p.status == "succeeded" and p.paid_at
    count = len(db.added)
    await payments.apply_payment(db, p, provider_data(p), o)
    assert len(db.added) == count == 2


@pytest.mark.asyncio
async def test_terminal_status_cannot_regress(config):
    db = FakeDB(); p = payment(); p.status = "succeeded"
    with pytest.raises(HTTPException): await payments.apply_payment(db, p, provider_data(p, "pending"), order(p))
    assert p.status == "succeeded"


@pytest.mark.asyncio
async def test_payment_after_order_cancel_requires_review(config):
    db = FakeDB(); p = payment()
    await payments.apply_payment(db, p, provider_data(p), order(p, "cancelled"))
    assert p.status == "succeeded" and p.needs_review


@pytest.mark.asyncio
async def test_unrecorded_provider_refund_remains_flagged_on_first_success(config):
    db = FakeDB(); p = payment(); data = provider_data(p)
    data["refunded_amount"] = {"value": "10.00", "currency": "RUB"}
    await payments.apply_payment(db, p, data, order(p))
    assert p.needs_review and p.reconciliation_status == "mismatch"


@pytest.mark.asyncio
async def test_timeout_keeps_durable_attempt_and_key(config, monkeypatch):
    db = FakeDB(); p = payment(); p.provider_id = None; p.status = "creating"
    mock = AsyncMock(side_effect=payments.ProviderError())
    monkeypatch.setattr(payments, "provider", mock)
    await payments.resolve_payment(db, p, order(p))
    assert p.status == "unknown"
    mock.assert_awaited_once_with("POST", "/payments", p.request_body, p.idempotence_key)
    assert not db.added


@pytest.mark.asyncio
async def test_uncertain_payment_never_replayed_after_idempotence_window(config, monkeypatch):
    db = FakeDB(); p = payment(); p.provider_id = None; p.status = "unknown"; p.created_at -= timedelta(days=2)
    mock = AsyncMock(); monkeypatch.setattr(payments, "provider", mock)
    await payments.resolve_payment(db, p, order(p))
    mock.assert_not_awaited()
    assert p.needs_review and p.reconciliation_status == "manual_review"


@pytest.mark.asyncio
async def test_foreign_order_cannot_be_paid(config, monkeypatch):
    db = FakeDB(); p = payment(); monkeypatch.setattr(payments, "locked_order", AsyncMock(return_value=order(p)))
    mock = AsyncMock(); monkeypatch.setattr(payments, "provider", mock)
    with pytest.raises(HTTPException) as exc: await payments.create_payment(db, p.order_id, SimpleNamespace(id=uuid4()))
    assert exc.value.status_code == 403
    mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_existing_attempt_is_reused_without_network(config, monkeypatch):
    db = FakeDB(); p = payment(); db.scalar.return_value = p
    monkeypatch.setattr(payments, "locked_order", AsyncMock(return_value=order(p)))
    mock = AsyncMock(); monkeypatch.setattr(payments, "provider", mock)
    assert await payments.create_payment(db, p.order_id, SimpleNamespace(id=p.client_id)) is p
    mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_order_read_authorization():
    from app.security.auth import OrderAccessActor
    db = FakeDB(); p = payment(); db.get.return_value = order(p)
    with pytest.raises(HTTPException) as exc: await authorized_order(db, p.order_id, OrderAccessActor(client=SimpleNamespace(id=uuid4())))
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_full_refund_duplicate_result(config, monkeypatch):
    db = FakeDB(); p = payment(); p.status = "succeeded"
    r = Refund(payment_id=p.id, amount=p.amount, provider_id="refund", status="pending", reason="Отмена заказа", created_at=datetime.now(UTC))
    response = {"id": "refund", "payment_id": p.provider_id, "status": "succeeded", "amount": {"value": str(p.amount), "currency": "RUB"}}
    monkeypatch.setattr(payments, "provider", AsyncMock(return_value=response))
    await payments.resolve_refund(db, r, p, order(p)); count = len(db.added)
    await payments.resolve_refund(db, r, p, order(p))
    assert r.refunded_at and p.refund_status == "succeeded" and len(db.added) == count


def test_receipt_positions_match_payment(config):
    p = payment(); q = SimpleNamespace(items=[{"description": "Песок", "amount": "100.00", "subject": "commodity"}, {"description": "Доставка", "amount": "23.45", "subject": "service"}])
    body = payments.build_payment_body(p, q, "buyer@example.invalid")
    assert sum(Decimal(i["amount"]["value"]) for i in body["receipt"]["items"]) == p.amount
    assert body["capture"] is True
    assert body["metadata"]["order_id"] == str(p.order_id)
    assert all(i["payment_mode"] == "full_prepayment" for i in body["receipt"]["items"])


def test_email_required_for_yookassa_receipts(config):
    with pytest.raises(HTTPException): payments.build_payment_body(payment(), SimpleNamespace(items=[]), None)


@pytest.mark.parametrize("value", ["=1+1", "+formula", "@SUM(A1)", "-1+1", "\t=1"])
def test_csv_formula_injection(value):
    assert csv_safe(value).startswith("'")


def test_report_inclusive_end_and_timezone():
    lo, hi = period(date(2026, 9, 1), date(2026, 9, 30))
    assert lo.date() == date(2026, 9, 1) and hi.date() == date(2026, 10, 1)
    assert lo.tzinfo is not None


@pytest.mark.parametrize("role", sorted(PARTNER_ROLES))
@pytest.mark.asyncio
async def test_partner_access_ignores_legacy_whitelist(role):
    u = SimpleNamespace(role=SimpleNamespace(name=role), wholesale_access_enabled=False, is_active=True, is_deleted=False, driver_profile=None)
    assert await board_user(u) is u
    u.wholesale_access_enabled = True
    assert await board_user(u) is u


def test_expired_announcement_not_public():
    assert not visible(SimpleNamespace(status="approved", ends_on=date(2000, 1, 1)))


def test_schema_rejects_invalid_dates():
    data = dict(city_id=uuid4(), material_name="Песок", volume="500", vehicle_count=25, pickup_address="Карьер", delivery_address="Стройка",
                starts_on="2026-09-30", ends_on="2026-09-29", price="500", contact_name="Заказчик", contact_phone="+79990000000")
    with pytest.raises(ValidationError): WholesaleInput(**data)


def test_openapi_contracts():
    from main import app
    paths = app.openapi()["paths"]
    for path in ["/api/v1/wholesale-requests", "/api/v1/orders/{order_id}/payments", "/api/v1/finance/payments", "/api/v1/finance/summary", "/api/v1/webhooks/yookassa"]:
        assert path in paths
