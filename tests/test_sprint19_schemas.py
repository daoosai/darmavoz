import pytest
from pydantic import ValidationError

from app.schemas.sprint19 import SepticProfileIn, WaterPointIn


def test_paid_water_requires_contact_and_price_fields():
    with pytest.raises(ValidationError):
        WaterPointIn(water_type="paid", source="Скважина", address="Тюмень", lat=57.1, lon=65.5)


def test_free_water_cannot_have_price():
    with pytest.raises(ValidationError):
        WaterPointIn(water_type="free", source="Родник", address="Тюмень", lat=57.1, lon=65.5, price=10)


def test_septic_profile_accepts_minimal_contract():
    item = SepticProfileIn(phone="+79990000000", address="Тюмень", lat=57.1, lon=65.5, tank_volume_m3=5, service_price=1500)
    assert item.tank_volume_m3 == 5
