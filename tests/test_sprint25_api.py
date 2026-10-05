"""Integration checks use the disposable database provided by conftest."""
from datetime import datetime, UTC, timedelta
from types import SimpleNamespace
from uuid import uuid4
import asyncio
import pytest
from fastapi import HTTPException
from sqlalchemy import select, func
from app.models.models import City, Client, Driver, DeliveryOption, Order, OrderOffer, PushDelivery, Role, TransportCategory, User, Vehicle, driver_cities
from app.security.jwt import create_access_token
from app.services.dispatch_service import create_offer_for_driver, accept_offer, get_matching_drivers
from app.services.notification_outbox import enqueue, run_delivery_tick

async def fleet(db):
    city = await db.scalar(select(City).where(City.code == 'tyumen'))
    category = TransportCategory(slug='qa-' + uuid4().hex, title='QA category ' + uuid4().hex, capacity_min_m3=1, capacity_max_m3=30)
    db.add(category)
    await db.flush()
    option = DeliveryOption(title='QA 20', capacity_m3=20, is_active=True, transport_category_id=category.id)
    client = Client(name='QA client', phone='+7' + str(uuid4().int % 10**10).zfill(10))
    db.add_all([option, client])
    await db.flush()
    vehicle = Vehicle(title='QA truck', transport_category_id=category.id, delivery_option_id=option.id, cubature_min=5, cubature_max=25, is_active=True, moderation_status='approved')
    db.add(vehicle)
    await db.flush()
    driver = Driver(name='QA driver', phone='+7' + str(uuid4().int % 10**10).zfill(10), vehicle_id=vehicle.id,
        status='available', is_active=True, is_on_shift=True, is_auto_dispatch_enabled=True, is_dispatch_eligible=True, moderation_status='approved')
    db.add(driver)
    await db.flush()
    driver.vehicle = vehicle
    vehicle.delivery_option = option
    return city, category, option, client, driver

async def make_order(db, city, category, option, client):
    order = Order(city_id=city.id, transport_category_id=category.id, client_id=client.id,
        delivery_option_id=option.id, status='searching_driver', total_amount=1000, address='QA delivery')
    db.add(order)
    await db.flush()
    await db.refresh(order, ['items', 'delivery_option'])
    return order


@pytest.mark.asyncio
async def test_logist_vehicle_management_preserves_permissions_and_busy_assignments(client, session_factory):
    async with session_factory() as db:
        city, category, option, customer, driver = await fleet(db)
        tokens = {}
        for name in ('logist', 'driver'):
            role = await db.scalar(select(Role).where(Role.name == name))
            if role is None:
                role = Role(name=name); db.add(role); await db.flush()
            actor = User(username='qa-vehicle-' + uuid4().hex, hashed_password='unused', role_id=role.id, is_active=True)
            db.add(actor); await db.flush()
            tokens[name] = create_access_token(data={'sub': actor.username})
        await db.commit()
        driver_id, vehicle_id = str(driver.id), str(driver.vehicle_id)
        payload = {'vehicle_id': vehicle_id, 'transport_category_id': str(category.id),
                   'delivery_option_id': str(option.id), 'cubature_min': 10, 'cubature_max': 10}
    path = f'/api/v1/admin/drivers/{driver_id}/vehicle'
    headers = {'Authorization': 'Bearer ' + tokens['logist']}
    assert (await client.patch(path, json=payload, headers={'Authorization': 'Bearer ' + tokens['driver']})).status_code == 403
    assert (await client.patch(path, json={**payload, 'is_dispatch_eligible': True}, headers=headers)).status_code == 422
    assert (await client.patch(path, json={**payload, 'cubature_min': 11}, headers=headers)).status_code == 422
    response = await client.patch(path, json=payload, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()['vehicle']['cubature_max'] == 10
    assert response.json()['vehicle']['transport_category_id'] == str(category.id)
    async with session_factory() as db:
        other = Driver(name='QA occupied', phone='+7' + str(uuid4().int % 10**10).zfill(10), vehicle_id=driver.vehicle_id)
        # A separate occupied vehicle exercises the real assignment guard.
        occupied = Vehicle(title='QA occupied vehicle', is_active=True, delivery_option_id=option.id)
        db.add(occupied); await db.flush(); other.vehicle_id = occupied.id
        db.add(other); await db.commit()
        occupied_id = str(occupied.id)
    available = await client.get(f'/api/v1/admin/drivers/{driver_id}/vehicles', headers=headers)
    assert available.status_code == 200, available.text
    assert occupied_id not in [vehicle['id'] for vehicle in available.json()]
    assert (await client.patch(path, json={**payload, 'vehicle_id': occupied_id}, headers=headers)).status_code == 409
    async with session_factory() as db:
        order = await make_order(db, city, category, option, customer)
        order.driver_id, order.status = driver.id, 'driver_assigned'
        await db.commit()
    assert (await client.patch(path, json=payload, headers=headers)).status_code == 409

@pytest.mark.asyncio
async def test_logist_can_assign_city_but_driver_cannot_and_active_order_protects_membership(client, session_factory):
    async with session_factory() as db:
        city, category, option, customer, driver = await fleet(db)
        role = await db.scalar(select(Role).where(Role.name == 'logist'))
        if role is None:
            role = Role(name='logist'); db.add(role); await db.flush()
        user = User(username='qa-logist-' + uuid4().hex, hashed_password='unused', role_id=role.id, is_active=True)
        db.add(user); await db.commit()
        token = create_access_token(data={'sub': user.username})
        driver_id, city_id = str(driver.id), str(city.id)
    headers = {'Authorization': 'Bearer ' + token}
    response = await client.patch(f'/api/v1/admin/drivers/{driver_id}/cities', json={'city_ids': [city_id]}, headers=headers)
    assert response.status_code == 200, response.text
    response = await client.get('/api/v1/admin/drivers', params={'city_id': city_id, 'q': 'QA driver'}, headers=headers)
    assert response.status_code == 200, response.text
    assert driver_id in [row['id'] for row in response.json()]
    response = await client.get('/api/v1/admin/drivers', params={'without_city': True}, headers=headers)
    assert driver_id not in [row['id'] for row in response.json()]
    async with session_factory() as db:
        order = await make_order(db, city, category, option, customer)
        order.driver_id, order.status = driver.id, 'driver_assigned'
        await db.commit()
    response = await client.patch(f'/api/v1/admin/drivers/{driver_id}/cities', json={'city_ids': []}, headers=headers)
    assert response.status_code == 409, response.text
    async with session_factory() as db:
        order = await db.get(Order, order.id); order.status = 'completed'; await db.commit()
    response = await client.patch(f'/api/v1/admin/drivers/{driver_id}/cities', json={'city_ids': []}, headers=headers)
    assert response.status_code == 200, response.text
    assert (await client.patch('/api/v1/profile/cities', json={'city_ids': [city_id]}, headers=headers)).status_code == 403

@pytest.mark.asyncio
async def test_legacy_dispatch_checks_city_category_and_shift(session_factory):
    async with session_factory() as db:
        city, category, option, customer, driver = await fleet(db)
        await db.execute(driver_cities.insert().values(driver_id=driver.id, city_id=city.id))
        order = await make_order(db, city, category, option, customer)
        assert driver.id in [item.id for item in await get_matching_drivers(db, order)]
        driver.is_on_shift = False; await db.flush()
        assert driver.id not in [item.id for item in await get_matching_drivers(db, order)]
        driver.is_on_shift = True
        driver.vehicle.transport_category_id = None
        driver.vehicle.delivery_option_id = None
        driver.vehicle.delivery_option = None
        await db.flush()
        assert driver.id not in [item.id for item in await get_matching_drivers(db, order)]
        await db.rollback()

@pytest.mark.asyncio
async def test_offer_reserves_driver_and_expired_offer_cannot_be_accepted(session_factory):
    async with session_factory() as db:
        city, category, option, customer, driver = await fleet(db)
        await db.execute(driver_cities.insert().values(driver_id=driver.id, city_id=city.id))
        first = await make_order(db, city, category, option, customer)
        second = await make_order(db, city, category, option, customer)
        offer = await create_offer_for_driver(db, first, driver)
        await db.commit()
        with pytest.raises(HTTPException) as conflict:
            await create_offer_for_driver(db, second, driver)
        assert conflict.value.status_code == 409
        offer.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db.commit()
        with pytest.raises(HTTPException) as expired:
            await accept_offer(db, offer_id=offer.id, driver_id=driver.id)
        assert expired.value.status_code == 409
        await db.rollback()

@pytest.mark.asyncio
async def test_delivery_is_transactional_deduplicated_and_retried(session_factory, monkeypatch):
    from sqlalchemy.ext.asyncio import async_sessionmaker
    # Keep all worker commits inside a rollback-only isolated outer transaction.
    async with session_factory.kw['bind'].connect() as connection:
        transaction = await connection.begin()
        isolated_factory = async_sessionmaker(connection, expire_on_commit=False,
                                             join_transaction_mode='create_savepoint')
        try:
            await connection.execute(PushDelivery.__table__.delete())
            await _check_delivery_retry(isolated_factory, monkeypatch)
        finally:
            await transaction.rollback()


async def _check_delivery_retry(session_factory, monkeypatch):
    async with session_factory() as db:
        role = await db.scalar(select(Role).where(Role.name == 'admin'))
        if role is None:
            role = Role(name='admin'); db.add(role); await db.flush()
        user = User(username='qa-notice-' + uuid4().hex, hashed_password='unused', role_id=role.id, is_active=True, fcm_token='qa-device-token')
        db.add(user); await db.commit()
        key = 'qa:' + uuid4().hex
        values = dict(key=key, recipient_type='user', recipient_id=user.id, event_type='qa_event', title='QA', body='QA', payload={}, inbox=True)
        assert await enqueue(db, **values)
        await db.rollback()
        assert await db.scalar(select(PushDelivery.id).where(PushDelivery.dedupe_key == key)) is None
        assert await enqueue(db, **values)
        assert not await enqueue(db, **values)
        await db.commit()
    def failed(*args): raise RuntimeError('temporary QA failure')
    monkeypatch.setattr('app.services.push_service._send_push', failed)
    await run_delivery_tick(session_factory)
    async with session_factory() as db:
        item = await db.scalar(select(PushDelivery).where(PushDelivery.dedupe_key == key))
        assert item.status == 'pending' and item.attempts == 1
        item.next_attempt_at = datetime.now(UTC) - timedelta(seconds=1)
        await db.commit()
    monkeypatch.setattr('app.services.push_service._send_push', lambda *args: 'qa-message-id')
    await run_delivery_tick(session_factory)
    async with session_factory() as db:
        item = await db.scalar(select(PushDelivery).where(PushDelivery.dedupe_key == key))
        assert item.status == 'sent' and item.attempts == 2
