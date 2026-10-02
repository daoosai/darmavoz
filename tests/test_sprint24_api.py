"""Integration tests exclusively in the disposable PostgreSQL fixture database."""
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.api.wholesale import today
from app.core.config import settings
from app.models.commerce import Payment, PaymentQuote
from app.models.models import City, Client, Driver, Order, Role, User, Vehicle
from app.security.jwt import create_access_token
from app.services import payments


async def create_actor(session, name, *, admitted=False):
    role = await session.scalar(select(Role).where(Role.name == name))
    if not role:
        role = Role(name=name, description=name); session.add(role); await session.flush()
    user = User(username=f"s24-{uuid4().hex}", role_id=role.id, hashed_password="test-only", wholesale_access_enabled=admitted)
    session.add(user); await session.flush()
    if name == "driver":
        vehicle = Vehicle(title="QA approved vehicle", brand="QA", plate_number=uuid4().hex[:10], moderation_status="approved", is_active=True)
        session.add(vehicle); await session.flush()
        user.driver_profile = Driver(name="QA approved driver", phone="+7" + str(int(uuid4().hex[:10], 16))[-10:],
                                     vehicle=vehicle, moderation_status="approved", is_active=True)
        await session.flush()
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
    assert submitted.status_code == 200 and submitted.json()['status'] == 'pending'
    assert (await client.get(f'/api/v1/wholesale-requests/{request_id}', headers=other_headers)).status_code == 404
    assert (await client.post(f'/api/v1/wholesale-requests/{request_id}/moderate', headers=partner_headers, json={'action': 'publish'})).status_code == 403
    response = await client.post(f'/api/v1/wholesale-requests/{request_id}/moderate', headers=admin, json={'action': 'publish'})
    assert response.status_code == 200, response.text
    response = await client.get('/api/v1/wholesale-requests?view=moderation&status=approved', headers=admin)
    assert response.status_code == 200 and request_id in [row['id'] for row in response.json()['items']]
    for status in ('pending', 'rejected', 'archived'):
        response = await client.get(f'/api/v1/wholesale-requests?view=moderation&status={status}', headers=admin)
        assert response.status_code == 200 and request_id not in [row['id'] for row in response.json()['items']]
    response = await client.get('/api/v1/wholesale-requests?view=moderation&status=all', headers=admin)
    assert response.status_code == 200 and request_id in [row['id'] for row in response.json()['items']]
    assert (await client.get('/api/v1/wholesale-requests?view=moderation&status=all', headers=other_headers)).status_code == 403
    assert (await client.get('/api/v1/wholesale-requests?status=pending', headers=other_headers)).status_code == 422
    assert (await client.get('/api/v1/wholesale-requests?view=moderation&status=invalid', headers=admin)).status_code == 422
    response = await client.get('/api/v1/wholesale-requests', headers=other_headers)
    assert request_id in [row['id'] for row in response.json()['items']]
    response = await client.put(f'/api/v1/wholesale-requests/{request_id}/favorite', headers=other_headers, json={'enabled': True})
    assert response.status_code == 200, response.text
    response = await client.get('/api/v1/wholesale-requests?view=favorites', headers=other_headers)
    assert response.json()['items'][0]['is_favorite'] is True
    response = await client.put(f'/api/v1/wholesale-requests/{request_id}', headers=partner_headers, json={**payload, 'price': '500'})
    assert response.status_code == 200 and response.json()['status'] == 'pending'
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

@pytest.mark.parametrize("author_role", ["supplier", "driver"])
@pytest.mark.asyncio
async def test_wholesale_full_moderation_and_push(client, session_factory, admin_token, monkeypatch, author_role):
    from app.models.models import Driver, PushDelivery, UserNotification
    from app.services.notification_outbox import run_delivery_tick
    async with session_factory() as db:
        author, headers = await create_actor(db, author_role)
        reader, reader_headers = await create_actor(db, "driver")
        city = await db.scalar(select(City).where(City.is_active.is_(True)).limit(1))
        author.fcm_token = "test-wholesale-token" if author_role == "supplier" else None
        if author_role == "driver":
            author.driver_profile.fcm_token = "test-driver-wholesale-token"
        await db.commit()
        author_id = author.id
        payload = dict(city_id=str(city.id), material_name="Песок", volume="500", unit="m3", vehicle_count=25,
                       pickup_address="Карьер", delivery_address="Стройка", starts_on=str(today()),
                       ends_on=str(today() + timedelta(days=10)), price="450", price_basis="m3",
                       contact_name="Автор", contact_phone="+79990000000")
    admin = {"Authorization": f"Bearer {admin_token}"}
    created = await client.post("/api/v1/wholesale-requests", headers=headers, json=payload)
    assert created.status_code == 201, created.text
    request_id = created.json()["id"]
    assert created.json()["status"] == "pending" and created.json()["reject_reason"] is None
    assert request_id not in [r["id"] for r in (await client.get("/api/v1/wholesale-requests", headers=reader_headers)).json()["items"]]
    queue = (await client.get("/api/v1/wholesale-requests?view=moderation", headers=admin)).json()["items"]
    assert request_id in [r["id"] for r in queue]
    path = f"/api/v1/wholesale-requests/{request_id}/moderate"
    assert (await client.post(path, headers=admin, json={"action": "reject", "reason": "   "})).status_code == 422
    reason = "Уточните место загрузки"
    rejected = await client.post(path, headers=admin, json={"action": "reject", "reason": reason})
    assert rejected.status_code == 200 and rejected.json()["reject_reason"] == reason
    repeated = await client.post(path, headers=admin, json={"action": "reject", "reason": reason})
    assert repeated.status_code == 200
    mine = (await client.get("/api/v1/wholesale-requests?view=mine", headers=headers)).json()["items"]
    assert any(r["id"] == request_id and r["status"] == "rejected" and r["reject_reason"] == reason for r in mine)
    sent = []
    monkeypatch.setattr("app.services.push_service._send_push", lambda token, title, body, data: sent.append((title, body, data)) or "test-fcm-id")
    await run_delivery_tick(session_factory)
    assert any(reason in body and data.get("wholesale_request_id") == request_id for _, body, data in sent)
    edited = await client.put(f"/api/v1/wholesale-requests/{request_id}", headers=headers,
                              json={**payload, "pickup_address": "Тюмень, карьер"})
    assert edited.status_code == 200 and edited.json()["status"] == "pending"
    assert edited.json()["reject_reason"] is None
    assert (await client.get(f"/api/v1/wholesale-requests/{request_id}", headers=reader_headers)).status_code == 404
    approved = await client.post(path, headers=admin, json={"action": "approve"})
    assert approved.status_code == 200 and approved.json()["status"] == "approved"
    assert (await client.post(path, headers=admin, json={"action": "approve"})).status_code == 200
    await run_delivery_tick(session_factory)
    assert any(data.get("wholesale_request_id") == request_id and data.get("status") == "approved" for _, _, data in sent)
    async with session_factory() as db:
        deliveries = list((await db.scalars(select(PushDelivery).where(PushDelivery.payload["wholesale_request_id"].astext == request_id,
                                                              PushDelivery.event_type.in_(["wholesale_approved", "wholesale_rejected"])))).all())
        assert len(deliveries) == 2 and all(d.status == "sent" for d in deliveries)
        assert all(d.recipient_type == ("driver" if author_role == "driver" else "user") for d in deliveries)
        inbox = list((await db.scalars(select(UserNotification).where(UserNotification.user_id == author_id,
                                    UserNotification.payload["wholesale_request_id"].astext == request_id))).all())
        assert len(inbox) == 2
    assert (await client.get(f"/api/v1/wholesale-requests/{request_id}", headers=reader_headers)).status_code == 200
    assert (await client.post(f"/api/v1/wholesale-requests/{request_id}/close", headers=headers)).json()["status"] == "archived"
    assert (await client.put(f"/api/v1/wholesale-requests/{request_id}", headers=headers, json=payload)).status_code == 409


@pytest.mark.asyncio
async def test_wholesale_migration_preserves_legacy_records(session_factory):
    import importlib.util
    from sqlalchemy import text
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    spec = importlib.util.spec_from_file_location("wholesale_migration", "alembic/versions/s24_wholesale_moderation_cycle.py")
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    schema = "qa_wholesale_" + uuid4().hex[:12]
    async with session_factory() as db:
        conn = await db.connection()
        await conn.execute(text(f"CREATE SCHEMA {schema}"))
        await conn.execute(text(f"SET LOCAL search_path TO {schema}"))
        await conn.execute(text("CREATE TABLE wholesale_requests (id serial PRIMARY KEY, status varchar(32), moderation_reason text)"))
        await conn.execute(text("CREATE TABLE wholesale_events (status varchar(32))"))
        for state in ("draft", "pending_moderation", "published", "hidden", "closed", "rejected"):
            await conn.execute(text("INSERT INTO wholesale_requests (status, moderation_reason) VALUES (:s, 'Старая причина')"), {"s": state})
            await conn.execute(text("INSERT INTO wholesale_events VALUES (:s)"), {"s": state})
        def apply(sync_conn):
            with Operations.context(MigrationContext.configure(sync_conn)):
                migration.upgrade()
        await conn.run_sync(apply)
        rows = (await conn.execute(text("SELECT status, reject_reason FROM wholesale_requests ORDER BY id"))).all()
        assert [s for s, _ in rows] == ["pending", "pending", "approved", "archived", "archived", "rejected"]
        assert rows[-1][1] == "Старая причина" and all(reason is None for _, reason in rows[:-1])
        assert (await conn.execute(text("SELECT count(*) FROM wholesale_events"))).scalar() == 6
        await db.rollback()  # Drops the isolated test schema and all temporary records.


@pytest.mark.asyncio
async def test_wholesale_optional_vehicle_count_roundtrip(client, session_factory, admin_token):
    async with session_factory() as db:
        _, headers = await create_actor(db, "supplier")
        _, driver_headers = await create_actor(db, "driver")
        city = await db.scalar(select(City).where(City.is_active.is_(True)).limit(1))
        city_id = str(city.id)
        await db.commit()
    payload = dict(city_id=city_id, material_name="Бой кирпича", volume="30",
                   pickup_address="Карьер А", delivery_address="Стройка Б",
                   starts_on=str(today()), ends_on=str(today()), price="150",
                   contact_name="Автор", contact_phone="+79990000000")
    for extra in ({}, {"vehicle_count": None}, {"vehicle_count": 0}):
        response = await client.post("/api/v1/wholesale-requests", headers=headers, json={**payload, **extra})
        assert response.status_code == 201, response.text
        row = response.json()
        assert row["vehicle_count"] is None and row["status"] == "pending"
        path = "/api/v1/wholesale-requests/" + row["id"]
        updated = await client.put(path, headers=headers, json={**payload, "vehicle_count": 7})
        assert updated.status_code == 200 and updated.json()["vehicle_count"] == 7
        cleared = await client.put(path, headers=headers, json=payload)
        assert cleared.status_code == 200 and cleared.json()["vehicle_count"] is None
        approved = await client.post(path + "/moderate", headers={"Authorization": f"Bearer {admin_token}"}, json={"action": "approve"})
        assert approved.status_code == 200
        viewed = await client.get(path, headers=driver_headers)
        assert viewed.status_code == 200 and viewed.json()["vehicle_count"] is None
    for invalid in (-1, 1.5, 100001):
        response = await client.post("/api/v1/wholesale-requests", headers=headers, json={**payload, "vehicle_count": invalid})
        assert response.status_code == 422


@pytest.mark.asyncio
async def test_wholesale_admin_pending_notifications(client, session_factory, admin_token, monkeypatch):
    from app.models.models import PushDelivery, UserNotification
    from app.services.notification_outbox import delivery_is_current, run_delivery_tick
    async with session_factory() as db:
        author, headers = await create_actor(db, "supplier")
        receiver, _ = await create_actor(db, "admin")
        receiver.fcm_token = "fake-admin-fcm"
        inactive, _ = await create_actor(db, "admin")
        inactive.is_active = False
        deleted, _ = await create_actor(db, "admin")
        deleted.is_deleted = True
        logist, _ = await create_actor(db, "logist")
        city = await db.scalar(select(City).where(City.is_active.is_(True)).limit(1))
        expected = set((await db.scalars(select(User.id).join(Role).where(
            Role.name == "admin", User.is_active.is_(True), User.is_deleted.is_(False)))).all())
        excluded = {inactive.id, deleted.id, logist.id, author.id}
        receiver_id = receiver.id
        await db.commit()
        payload = dict(city_id=str(city.id), material_name="Бой кирпича", volume="30",
                       pickup_address="Карьер А", delivery_address="Стройка Б",
                       starts_on=str(today()), ends_on=str(today()), price="150",
                       contact_name="Автор", contact_phone="+79990000000")
    created = await client.post("/api/v1/wholesale-requests", headers=headers, json=payload)
    assert created.status_code == 201
    request_id = created.json()["id"]
    path = "/api/v1/wholesale-requests/" + request_id
    async with session_factory() as db:
        deliveries = list((await db.scalars(select(PushDelivery).where(
            PushDelivery.payload["wholesale_request_id"].astext == request_id,
            PushDelivery.event_type == "wholesale_pending"))).all())
        assert {d.recipient_id for d in deliveries} == expected
        assert not {d.recipient_id for d in deliveries}.intersection(excluded)
        inbox = list((await db.scalars(select(UserNotification).where(
            UserNotification.payload["wholesale_request_id"].astext == request_id))).all())
        assert {n.user_id for n in inbox} == expected
        first_id = next(d.id for d in deliveries if d.recipient_id == receiver_id)
    sent = []
    monkeypatch.setattr("app.services.push_service._send_push",
                        lambda token, title, body, data: sent.append((token, data)) or "test-fcm-id")
    # A tick is intentionally limited to 30; earlier tests leave a queue backlog.
    for _ in range(20):
        await run_delivery_tick(session_factory)
        if any(token == "fake-admin-fcm" and data.get("wholesale_request_id") == request_id
               for token, data in sent):
            break
    assert any(token == "fake-admin-fcm" and data.get("wholesale_request_id") == request_id
               and data.get("status") == "pending" for token, data in sent)
    assert (await client.post(path + "/submit", headers=headers)).status_code == 200
    async with session_factory() as db:
        notes = list((await db.scalars(select(UserNotification).where(
            UserNotification.user_id == receiver_id,
            UserNotification.payload["wholesale_request_id"].astext == request_id))).all())
        assert len(notes) == 1  # Legacy duplicate submit is idempotent.
    edited = await client.put(path, headers=headers, json={**payload, "delivery_address": "Стройка Б, улица 10"})
    assert edited.status_code == 200
    async with session_factory() as db:
        old = await db.get(PushDelivery, first_id)
        assert not await delivery_is_current(db, old)
    assert (await client.post(path + "/moderate", headers={"Authorization": f"Bearer {admin_token}"},
                             json={"action": "reject", "reason": "Уточните адрес"})).status_code == 200
    resubmitted = await client.put(path, headers=headers, json={**payload, "delivery_address": "Стройка Б, улица 12"})
    assert resubmitted.status_code == 200 and resubmitted.json()["status"] == "pending"
    async with session_factory() as db:
        notes = list((await db.scalars(select(UserNotification).where(
            UserNotification.user_id == receiver_id,
            UserNotification.payload["wholesale_request_id"].astext == request_id))).all())
        assert len(notes) == 3
        assert sum(n.title == "Оптовая заявка снова на модерации" for n in notes) == 2


@pytest.mark.asyncio
async def test_private_draft_edit_and_submit(client, session_factory, admin_token):
    from app.models.models import PushDelivery, UserNotification
    async with session_factory() as db:
        author, headers = await create_actor(db, "supplier")
        _, driver_headers = await create_actor(db, "driver")
        city = await db.scalar(select(City).where(City.is_active.is_(True)).limit(1))
        await db.commit()
        payload = dict(city_id=str(city.id), material_name="Черновик песка", volume="30",
                       pickup_address="Карьер А", delivery_address="Стройка Б",
                       starts_on=str(today()), ends_on=str(today()), price="150",
                       contact_name="Автор", contact_phone="+79990000000")
    admin = {"Authorization": f"Bearer {admin_token}"}
    response = await client.post("/api/v1/wholesale-requests?draft=true", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "draft"
    request_id = response.json()["id"]
    path = "/api/v1/wholesale-requests/" + request_id
    async def assert_no_notifications():
        async with session_factory() as db:
            for model in (PushDelivery, UserNotification):
                assert not (await db.scalars(select(model).where(model.payload["wholesale_request_id"].astext == request_id))).all()
    await assert_no_notifications()
    for reader in (admin, driver_headers):
        assert (await client.get(path, headers=reader)).status_code == 404
        assert (await client.get(path + "/history", headers=reader)).status_code == 403
    for view in ("all", "moderation"):
        feed = await client.get(f"/api/v1/wholesale-requests?view={view}", headers=admin)
        assert request_id not in [row["id"] for row in feed.json()["items"]]
    feed = await client.get("/api/v1/wholesale-requests?view=moderation&status=all", headers=admin)
    assert request_id not in [row["id"] for row in feed.json()["items"]]
    feed = await client.get("/api/v1/wholesale-requests?view=mine", headers=headers)
    assert request_id in [row["id"] for row in feed.json()["items"]]
    assert (await client.post(path + "/moderate", headers=admin, json={"action": "approve"})).status_code == 409
    assert (await client.put(path + "?draft=true", headers=driver_headers, json=payload)).status_code == 403
    response = await client.put(path + "?draft=true", headers=headers, json={**payload, "delivery_address": "Стройка Б, улица 10"})
    assert response.status_code == 200 and response.json()["status"] == "draft"
    await assert_no_notifications()
    response = await client.put(path, headers=headers, json={**payload, "delivery_address": "Стройка Б, улица 20"})
    assert response.status_code == 200 and response.json()["status"] == "pending"
    assert response.json()["reject_reason"] is None
    async with session_factory() as db:
        assert (await db.scalars(select(UserNotification).where(UserNotification.payload["wholesale_request_id"].astext == request_id))).all()
    response = await client.post(path + "/moderate", headers=admin, json={"action": "approve"})
    assert response.status_code == 200 and response.json()["status"] == "approved"
    assert (await client.get(path, headers=driver_headers)).status_code == 200


@pytest.mark.asyncio
async def test_supplier_all_includes_own_requests_without_leaking_others(client, session_factory):
    from datetime import timedelta
    from app.models.commerce import WholesaleRequest, WholesaleFavorite
    async with session_factory() as db:
        author, headers = await create_actor(db, "supplier")
        other, other_headers = await create_actor(db, "supplier")
        _, driver_headers = await create_actor(db, "driver")
        city = await db.scalar(select(City).where(City.is_active.is_(True)).limit(1))
        tag = "supplier-all-" + uuid4().hex
        own, foreign = [], []
        for user, target in ((author, own), (other, foreign)):
            for status in ("draft", "pending", "rejected", "approved", "archived", "expired"):
                row = WholesaleRequest(author_id=user.id, city_id=city.id, material_name=tag,
                    volume=30, unit="m3", pickup_address="Карьер А", delivery_address="Стройка Б",
                    starts_on=today() - timedelta(days=2),
                    ends_on=today() - timedelta(days=1) if status == "expired" else today(),
                    price=150, price_basis="m3", contact_name="Автор", contact_phone="+79990000000",
                    status="approved" if status == "expired" else status,
                    reject_reason="Уточните адрес" if status == "rejected" else None)
                db.add(row); await db.flush(); target.append(str(row.id))
        db.add(WholesaleFavorite(user_id=author.id, request_id=UUID(own[0]), enabled=True))
        await db.commit()
    async def feed(auth, **params):
        response = await client.get("/api/v1/wholesale-requests", headers=auth, params={"q": tag, **params})
        assert response.status_code == 200, response.text
        return response.json()
    result = await feed(headers, view="all")
    assert result["total"] == 7
    assert {row["id"] for row in result["items"]} == set(own + [foreign[3]])
    assert sum(row["is_owner"] for row in result["items"]) == 6
    assert any(row["status"] == "draft" for row in result["items"])
    assert {row["id"] for row in (await feed(other_headers, view="all"))["items"]} == set(foreign + [own[3]])
    assert {row["id"] for row in (await feed(driver_headers, view="all"))["items"]} == {own[3], foreign[3]}
    assert (await feed(headers, view="favorites"))["total"] == 0
    assert (await feed(headers, view="all", starts_on=str(today() + timedelta(days=1))))["total"] == 0
    pages = [await feed(headers, view="all", page=number, page_size=3) for number in (1, 2, 3)]
    assert all(page["total"] == 7 for page in pages)
    ids = [row["id"] for page in pages for row in page["items"]]
    assert len(ids) == len(set(ids)) == 7


@pytest.mark.parametrize("driver_status,vehicle_status", [
    ("incomplete", "approved"), ("pending_moderation", "approved"), ("rejected", "approved"),
    ("approved", "incomplete"), ("approved", "pending_moderation"), ("approved", "rejected"),
    ("approved", "missing"), ("missing", "approved"), ("approved", "inactive"),
])
@pytest.mark.asyncio
async def test_wholesale_requires_approved_driver_and_vehicle(client, session_factory, driver_status, vehicle_status):
    async with session_factory() as db:
        user, headers = await create_actor(db, "driver")
        driver = user.driver_profile
        if driver_status == "missing":
            await db.delete(driver)
        else:
            driver.moderation_status = driver_status
            if vehicle_status == "missing":
                driver.vehicle = None
            elif vehicle_status == "inactive":
                driver.vehicle.is_active = False
            else:
                driver.vehicle.moderation_status = vehicle_status
        await db.commit()
    for suffix in ("?view=all", "?view=mine", "?view=favorites", "/access", "/" + str(uuid4()), "/" + str(uuid4()) + "/history"):
        response = await client.get("/api/v1/wholesale-requests" + suffix, headers=headers)
        assert response.status_code == 403, response.text
    assert (await client.post("/api/v1/wholesale-requests", headers=headers, json={})).status_code == 403
