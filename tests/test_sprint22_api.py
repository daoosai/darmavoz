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
