"""Integration tests exclusively in the disposable PostgreSQL fixture database."""
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.api.wholesale import today
from app.core.config import settings
from app.models.commerce import Payment, PaymentQuote
from app.models.models import City, Client, Order, Role, User
from app.security.jwt import create_access_token
from app.services import payments


async def create_actor(session, name, *, admitted=False):
    role = await session.scalar(select(Role).where(Role.name == name))
    if not role:
        role = Role(name=name, description=name); session.add(role); await session.flush()
    user = User(username=f"s24-{uuid4().hex}", role_id=role.id, hashed_password="test-only", wholesale_access_enabled=admitted)
    session.add(user); await session.flush()
    headers = {"Authorization": f"Bearer {create_access_token({'sub': user.username, 'role': name})}"}
    return user, headers


@pytest.mark.parametrize("partner_role", ["supplier", "driver"])
@pytest.mark.asyncio
async def test_wholesale_role_access_moderation_and_ownership(client, session_factory, admin_token, partner_role):
    async with session_factory() as db:
        partner, partner_headers = await create_actor(db, partner_role)
        other, other_headers = await create_actor(db, "driver" if partner_role == "supplier" else "supplier")
        city = await db.scalar(select(City).where(City.is_active.is_(True)).limit(1))
        customer = Client(name="s24-client", email=f"{uuid4().hex}@example.invalid"); db.add(customer)
        await db.commit()
        partner_id, city_id, customer_id = str(partner.id), str(city.id), str(customer.id)
    admin = {"Authorization": f"Bearer {admin_token}"}
    customer_headers = {"Authorization": f"Bearer {create_access_token({'sub': customer.email, 'role': 'client', 'client_id': customer_id})}"}
    assert (await client.get('/api/v1/wholesale-requests', headers=partner_headers)).status_code == 200
    assert (await client.get('/api/v1/wholesale-requests', headers=customer_headers)).status_code == 403
    access = await client.get('/api/v1/wholesale-requests/access', headers=partner_headers)
    assert access.status_code == 200 and access.json()['enabled'] is True
    payload = dict(city_id=city_id, material_name="Песок", volume="500", unit="m3", vehicle_count=25, pickup_address="Карьер",
                   delivery_address="Стройка", starts_on=str(today()), ends_on=str(today() + timedelta(days=10)), price="450", price_basis="m3", contact_name="Автор", contact_phone="+79990000000")
    response = await client.post('/api/v1/wholesale-requests', headers=partner_headers, json=payload)
    assert response.status_code == 201, response.text
    request_id = response.json()['id']
    assert (await client.get(f'/api/v1/wholesale-requests/{request_id}', headers=other_headers)).status_code == 404
    assert (await client.put(f'/api/v1/wholesale-requests/{request_id}', headers=other_headers, json=payload)).status_code == 403
    submitted = await client.post(f'/api/v1/wholesale-requests/{request_id}/submit', headers=partner_headers)
    assert submitted.status_code == 200 and submitted.json()['status'] == 'pending_moderation'
    assert (await client.get(f'/api/v1/wholesale-requests/{request_id}', headers=other_headers)).status_code == 404
    assert (await client.post(f'/api/v1/wholesale-requests/{request_id}/moderate', headers=partner_headers, json={'action': 'publish'})).status_code == 403
    response = await client.post(f'/api/v1/wholesale-requests/{request_id}/moderate', headers=admin, json={'action': 'publish'})
    assert response.status_code == 200, response.text
    response = await client.get('/api/v1/wholesale-requests', headers=other_headers)
    assert request_id in [row['id'] for row in response.json()['items']]
    response = await client.put(f'/api/v1/wholesale-requests/{request_id}/favorite', headers=other_headers, json={'enabled': True})
    assert response.status_code == 200, response.text
    response = await client.get('/api/v1/wholesale-requests?view=favorites', headers=other_headers)
    assert response.json()['items'][0]['is_favorite'] is True
    response = await client.put(f'/api/v1/wholesale-requests/{request_id}', headers=partner_headers, json={**payload, 'price': '500'})
    assert response.status_code == 200 and response.json()['status'] == 'pending_moderation'
    assert (await client.get(f'/api/v1/wholesale-requests/{request_id}', headers=other_headers)).status_code == 404


@pytest.mark.asyncio
async def test_confirmed_quote_order_contract_and_disabled_payments(client, session_factory, admin_token, monkeypatch):
    monkeypatch.setattr(settings, "PAYMENTS_ENABLED", False)
    async with session_factory() as db:
        customer = Client(name="Покупатель спринт 24", email=f"{uuid4().hex}@example.invalid")
        db.add(customer); await db.flush()
        order = Order(client_id=customer.id, total_amount=100, delivery_cost=23.45, status="created")
        db.add(order); await db.commit()
        order_id, customer_id = str(order.id), str(customer.id)
    admin = {"Authorization": f"Bearer {admin_token}"}
    buyer = {"Authorization": f"Bearer {create_access_token({'sub': customer.email, 'role': 'client', 'client_id': customer_id})}"}
    quote = {'amount': '123.45', 'material_amount': '100', 'delivery_amount': '23.45'}
    assert (await client.post(f'/api/v1/orders/{order_id}/payment-quote', headers=buyer, json=quote)).status_code in (401, 403)
    response = await client.post(f'/api/v1/orders/{order_id}/payment-quote', headers=admin, json=quote)
    assert response.status_code == 200, response.text
    response = await client.get(f'/api/v1/orders/{order_id}/payments', headers=buyer)
    assert response.status_code == 200 and response.json()['quote']['amount'] == '123.45'
    assert response.json()['can_pay'] is False
    response = await client.post(f'/api/v1/orders/{order_id}/payments', headers=buyer, json={})
    assert response.status_code == 503
    response = await client.get(f'/api/v1/orders/{order_id}', headers=admin)
    assert response.status_code == 200, response.text
    assert response.json()['confirmed_payment_amount'] == 123.45
    assert response.json()['payment_status'] is None
    response = await client.get('/api/v1/finance/payments', headers=buyer)
    assert response.status_code in (401, 403)
    response = await client.get('/api/v1/finance/summary', headers=admin)
    assert response.status_code == 200, response.text
    response = await client.get('/api/v1/finance/export', headers=admin)
    assert response.status_code == 200 and 'text/csv' in response.headers['content-type']


@pytest.mark.asyncio
async def test_payment_receipt_refund_and_ledger_roundtrip(client, session_factory, admin_token, monkeypatch):
    for name, value in {
        'PAYMENTS_ENABLED': True, 'YOOKASSA_SHOP_ID': 'test-shop', 'YOOKASSA_SECRET_KEY': 'fake-not-a-secret',
        'YOOKASSA_API_BASE_URL': 'https://example.invalid/v3', 'PAYMENT_RETURN_URL': 'https://example.invalid/app',
        'PAYMENT_TEST_MODE': True, 'PAYMENT_RECEIPTS_ENABLED': True, 'PAYMENT_RECEIPT_VAT_CODE': 1,
        'PAYMENT_RECEIPT_MODE': 'full_prepayment',
    }.items():
        monkeypatch.setattr(settings, name, value)
    calls, objects = [], {}

    async def fake_provider(method, path, body=None, key=None):
        calls.append((method, path, body, key))
        if path == '/payments':
            result = dict(id='s24-provider-' + uuid4().hex, status='pending', amount=body['amount'],
                          recipient={'account_id': 'test-shop'}, metadata=body['metadata'], test=True,
                          payment_method={'type': 'sbp'}, confirmation={'confirmation_url': 'https://example.invalid/pay'})
            objects[result['id']] = result
            return result
        if path == '/refunds':
            result = dict(id='s24-refund-' + uuid4().hex, status='succeeded', amount=body['amount'], payment_id=body['payment_id'])
            objects[result['id']] = result
            return result
        if path == '/receipts':
            result = {'id': 's24-receipt-' + uuid4().hex, 'status': 'succeeded'}
            objects[result['id']] = result
            return result
        return objects[path.rsplit('/', 1)[-1]]

    monkeypatch.setattr(payments, 'provider', fake_provider)
    async with session_factory() as db:
        customer = Client(name='Sprint24 payer', email=f'{uuid4().hex}@example.invalid')
        db.add(customer); await db.flush()
        order = Order(client_id=customer.id, total_amount=100, delivery_cost=23.45, status='created')
        db.add(order); await db.commit()
        order_id, customer_id = str(order.id), str(customer.id)
    admin = {'Authorization': f'Bearer {admin_token}'}
    buyer = {'Authorization': f"Bearer {create_access_token({'sub': customer.email, 'role': 'client', 'client_id': customer_id})}"}
    quote = dict(amount='123.45', material_amount='100.00', delivery_amount='23.45')
    assert (await client.post(f'/api/v1/orders/{order_id}/payment-quote', headers=admin, json=quote)).status_code == 200
    response = await client.post(f'/api/v1/orders/{order_id}/payments', headers=buyer, json={})
    assert response.status_code == 200, response.text
    assert response.json()['amount'] == '123.45' and response.json()['status'] == 'pending'
    payment_id, provider_id = response.json()['id'], response.json()['provider_id']
    repeated = await client.post(f'/api/v1/orders/{order_id}/payments', headers=buyer, json={})
    assert repeated.json()['id'] == payment_id
    assert len([c for c in calls if c[:2] == ('POST', '/payments')]) == 1
    assert (await client.post(f'/api/v1/orders/{order_id}/payment-quote', headers=admin, json=quote)).status_code == 409
    objects[provider_id].update(status='succeeded', captured_at=datetime.now(UTC).isoformat())
    notification = dict(event='payment.succeeded', object={'id': provider_id})
    for _ in range(2):
        response = await client.post('/api/v1/webhooks/yookassa', json=notification)
        assert response.status_code == 200, response.text
    detail = (await client.get(f'/api/v1/payments/{payment_id}', headers=buyer)).json()
    assert len([e for e in detail['events'] if e['type'] == 'payment_succeeded']) == 1
    async with session_factory() as db:
        order = await db.get(Order, order.id)
        order.status = 'completed'; await db.commit()
    assert (await client.post('/api/v1/webhooks/yookassa', json=notification)).status_code == 200
    receipts = [c for c in calls if c[:2] == ('POST', '/receipts')]
    assert len(receipts) == 1 and receipts[0][2]['settlements'][0]['amount']['value'] == '123.45'
    assert (await client.post(f'/api/v1/payments/{payment_id}/refund', headers=buyer, json={'reason': 'Test refund'})).status_code in (401, 403)
    for _ in range(2):
        response = await client.post(f'/api/v1/payments/{payment_id}/refund', headers=admin, json={'reason': 'Test refund'})
        assert response.status_code == 200 and response.json()['status'] == 'succeeded', response.text
    refunds = [c for c in calls if c[:2] == ('POST', '/refunds')]
    assert len(refunds) == 1 and all(i['payment_mode'] == 'full_payment' for i in refunds[0][2]['receipt']['items'])
    response = await client.get('/api/v1/finance/summary', headers=admin, params={'order_query': order_id})
    assert response.json()['paid'] == response.json()['refunded'] == '123.45'
    assert response.json()['net'] == '0.00'
    response = await client.get('/api/v1/finance/payments', headers=admin, params={'status': 'refunded', 'order_query': order_id})
    assert response.json()['total'] == 1 and response.json()['items'][0]['refund_status'] == 'succeeded'

@pytest.mark.parametrize("role", ["equipment_owner", "water_septic_partner"])
@pytest.mark.asyncio
async def test_wholesale_rejects_other_partner_roles_even_with_legacy_flag(client, session_factory, role):
    async with session_factory() as db:
        user, headers = await create_actor(db, role, admitted=True)
        await db.commit()
    for path in ("/api/v1/wholesale-requests", "/api/v1/wholesale-requests/access"):
        assert (await client.get(path, headers=headers)).status_code == 403
    assert (await client.post("/api/v1/wholesale-requests", headers=headers, json={})).status_code == 403


@pytest.mark.parametrize("role", ["supplier", "driver"])
@pytest.mark.parametrize("blocked_field", ["is_active", "is_deleted"])
@pytest.mark.asyncio
async def test_wholesale_rejects_blocked_accounts(client, session_factory, role, blocked_field):
    async with session_factory() as db:
        user, headers = await create_actor(db, role)
        setattr(user, blocked_field, blocked_field == "is_deleted")
        await db.commit()
    for path in ("/api/v1/wholesale-requests", "/api/v1/wholesale-requests/access"):
        assert (await client.get(path, headers=headers)).status_code == 401
    assert (await client.post("/api/v1/wholesale-requests", headers=headers, json={})).status_code == 401
