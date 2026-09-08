"""Run only against the disposable PostgreSQL service in CI."""
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.models import City, Driver, driver_cities
from app.services.cities import ensure_driver_city
from fastapi import HTTPException
from types import SimpleNamespace


@pytest.mark.asyncio
async def test_city_lifecycle_and_public_water_isolation(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    cities = (await client.get('/api/v1/cities/')).json()
    tyumen = next(city for city in cities if city['code'] == 'tyumen')
    payload = {key: tyumen[key] for key in (
        'name', 'region', 'code', 'center_lat', 'center_lon', 'map_zoom',
        'min_lat', 'min_lon', 'max_lat', 'max_lon', 'sort_order',
    )}
    payload.update(name='Тестовый город', code=f'ci-{uuid4().hex}')
    assert (await client.post('/api/v1/admin/cities/', json=payload)).status_code in (401, 403)
    response = await client.post('/api/v1/admin/cities/', json=payload, headers=headers)
    assert response.status_code == 201, response.text
    city = response.json()
    assert city['is_active'] is False
    assert city['id'] not in [item['id'] for item in (await client.get('/api/v1/cities/')).json()]
    response = await client.patch(f"/api/v1/admin/cities/{city['id']}", json={'is_active': True}, headers=headers)
    assert response.status_code == 200, response.text
    assert city['id'] in [item['id'] for item in (await client.get('/api/v1/cities/')).json()]

    points = []
    for market in (tyumen, city):
        response = await client.post('/api/v1/admin/water-points', headers=headers, json={
            'city_id': market['id'], 'water_type': 'free', 'source': 'CI источник',
            'address': 'CI адрес', 'lat': market['center_lat'], 'lon': market['center_lon'], 'is_free': True,
        })
        assert response.status_code == 201, response.text
        points.append(response.json())
    for index, market in enumerate((tyumen, city)):
        response = await client.get('/api/v1/water-points', params={'city_id': market['id']})
        assert response.status_code == 200, response.text
        ids = [point['id'] for point in response.json()]
        assert points[index]['id'] in ids
        assert points[1-index]['id'] not in ids
        response = await client.get(f"/api/v1/water-points/{points[1-index]['id']}", params={'city_id': market['id']})
        assert response.status_code == 404
    legacy = (await client.get('/api/v1/water-points')).json()
    assert points[0]['id'] in [point['id'] for point in legacy]
    assert points[1]['id'] not in [point['id'] for point in legacy]
    assert (await client.patch(f"/api/v1/admin/cities/{tyumen['id']}", json={'is_active': False}, headers=headers)).status_code == 409
    assert (await client.patch(f"/api/v1/admin/cities/{city['id']}", json={'is_active': False}, headers=headers)).status_code == 200
    assert (await client.get('/api/v1/water-points', params={'city_id': city['id']})).status_code == 409
    assert (await client.get('/api/v1/cities/')).status_code == 200


@pytest.mark.asyncio
async def test_simplified_city_create_generates_code_and_bounds(client, admin_token):
    response = await client.post('/api/v1/admin/cities/', headers={"Authorization": f"Bearer {admin_token}"}, json={
        'name': 'Екатеринбург', 'region': 'Свердловская область',
        'center_lat': 56.838011, 'center_lon': 60.597465, 'map_zoom': 11,
    })
    assert response.status_code == 201, response.text
    city = response.json()
    assert city['code'] == 'ekaterinburg'
    assert city['min_lat'] < city['center_lat'] < city['max_lat']
    assert city['min_lon'] < city['center_lon'] < city['max_lon']


@pytest.mark.asyncio
async def test_driver_membership_and_unknown_historical_city(session_factory):
    async with session_factory() as db:
        city = await db.scalar(select(City).where(City.code == 'tyumen'))
        driver = Driver(name='CI водитель', phone=f'+7{uuid4().int % 10**10:010d}')
        db.add(driver)
        await db.flush()
        order = SimpleNamespace(city_id=city.id)
        with pytest.raises(HTTPException):
            await ensure_driver_city(db, order, driver.id)
        await db.execute(driver_cities.insert().values(driver_id=driver.id, city_id=city.id))
        await ensure_driver_city(db, order, driver.id)
        with pytest.raises(HTTPException):
            await ensure_driver_city(db, SimpleNamespace(city_id=uuid4()), driver.id)
        with pytest.raises(HTTPException):
            await ensure_driver_city(db, SimpleNamespace(city_id=None), driver.id)
        await db.rollback()


@pytest.mark.asyncio
async def test_dispatch_queries_offers_and_manual_assignment_respect_city(session_factory):
    from app.api.drivers import build_driver_list_query
    from app.models.models import Client, DeliveryOption, Order, Role, User, Vehicle
    from app.services.dispatch_service import (
        _matching_drivers_base_query, assign_order_to_driver_manually, create_offer_for_driver,
    )
    async with session_factory() as db:
        city = await db.scalar(select(City).where(City.code == 'tyumen'))
        role = await db.scalar(select(Role).where(Role.name == 'driver'))
        if role is None:
            role = Role(name='driver')
            db.add(role)
        option = DeliveryOption(title='CI 20', capacity_m3=20, is_active=True)
        customer = Client(name='CI customer', phone=f'+7{uuid4().int % 10**10:010d}')
        db.add_all([option, customer])
        await db.flush()
        drivers = []
        for index in range(2):
            user = User(username=f'ci-driver-{uuid4().hex}', hashed_password='unused-ci', role_id=role.id, is_active=True)
            vehicle = Vehicle(title='CI vehicle', delivery_option_id=option.id, cubature_min=10, cubature_max=30, is_active=True, moderation_status='approved')
            db.add_all([user, vehicle])
            await db.flush()
            driver = Driver(name=f'CI {index}', phone=f'+7{uuid4().int % 10**10:010d}', user_id=user.id, vehicle_id=vehicle.id, status='available', is_active=True, is_auto_dispatch_enabled=True, moderation_status='approved')
            db.add(driver)
            await db.flush()
            drivers.append(driver)
        await db.execute(driver_cities.insert().values(driver_id=drivers[0].id, city_id=city.id))
        order = Order(city_id=city.id, client_id=customer.id, delivery_option_id=option.id, address='CI address', total_amount=1000, status='searching_driver')
        db.add(order)
        await db.flush()
        await db.refresh(order, ['delivery_option', 'items'])
        for query in (build_driver_list_query(order=order), _matching_drivers_base_query(order)):
            candidates = list((await db.scalars(query)).unique().all())
            assert drivers[0].id in [driver.id for driver in candidates]
            assert drivers[1].id not in [driver.id for driver in candidates]
        with pytest.raises(HTTPException) as rejected_offer:
            await create_offer_for_driver(db, order, drivers[1])
        assert rejected_offer.value.status_code == 409
        with pytest.raises(HTTPException) as rejected_assignment:
            await assign_order_to_driver_manually(db, order_id=order.id, driver_id=drivers[1].id)
        assert rejected_assignment.value.status_code == 409
        await db.rollback()
