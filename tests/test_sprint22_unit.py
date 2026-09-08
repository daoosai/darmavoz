from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.cities import update_city
from app.models.models import City
from app.schemas.calculator import CalculatorReferences
from app.schemas.catalog import MaterialCreate, MaterialUpdate
from app.schemas.city import CityCreate, CityUpdate
from app.services.cities import resolve_city


def city_data(**changes):
    return dict(name="Тюмень", region="Тюменская область", code="tyumen",
                center_lat=57.152286, center_lon=65.534328, map_zoom=11,
                min_lat=56.95, min_lon=65.1, max_lat=57.45, max_lon=65.95,
                sort_order=0, **changes)


@pytest.mark.parametrize("field,value", [("center_lat", float('nan')), ("center_lon", float('inf')), ("map_zoom", 0), ("min_lat", 58), ("code", 'Bad Code'), ("name", ' ')])
def test_city_geo_validation(field, value):
    data = city_data()
    data[field] = value
    with pytest.raises(ValidationError):
        CityCreate(**data)


def test_city_create_is_inactive_only_and_patch_rejects_null():
    with pytest.raises(ValidationError):
        CityCreate(**city_data(), is_active=True)
    with pytest.raises(ValidationError):
        CityUpdate(name=None)


@pytest.mark.parametrize('density', [0, -1, float('inf'), float('nan')])
def test_material_density_validation(density):
    with pytest.raises(ValidationError):
        MaterialUpdate(bulk_density_t_m3=density)


def test_calculator_reference_never_serializes_prices():
    refs = CalculatorReferences(materials=[dict(id=uuid4(), name='Песок', bulk_density_t_m3=None, price=99)],
                                delivery_options=[dict(id=uuid4(), title='20 м³', capacity_m3=20, base_price=5000)])
    assert 'price' not in refs.model_dump_json()
    assert MaterialCreate(name='Песок', unit='м3').bulk_density_t_m3 is None


class FakeDb:
    def __init__(self, cities):
        self.cities, self.statements = cities, []

    async def scalar(self, stmt):
        self.statements.append(stmt)
        return self.cities[0] if self.cities else None

    async def scalars(self, stmt):
        return self

    def all(self):
        return self.cities

    async def execute(self, stmt):
        self.statements.append(stmt)


@pytest.mark.asyncio
async def test_legacy_city_uses_code_not_default():
    city = City(id=uuid4(), **city_data(), is_active=True, is_default=False)
    db = FakeDb([city])
    assert await resolve_city(db, None) is city
    assert list(db.statements[0].compile().params.values()) == ['tyumen']


@pytest.mark.asyncio
async def test_invalid_city_does_not_fallback():
    with pytest.raises(HTTPException) as error:
        await resolve_city(FakeDb([]), uuid4())
    assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_cannot_disable_default_or_rename_legacy_city():
    city = City(id=uuid4(), **city_data(), is_active=True, is_default=True)
    for payload in [CityUpdate(is_active=False), CityUpdate(code='another'), CityUpdate(is_default=False)]:
        with pytest.raises(HTTPException) as error:
            await update_city(city.id, payload, FakeDb([city]))
        assert error.value.status_code == 409
