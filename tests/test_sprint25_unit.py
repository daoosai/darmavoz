from datetime import datetime, UTC, timedelta
from types import SimpleNamespace
from uuid import uuid4
import pytest
from sqlalchemy.dialects import postgresql
from app.services.driver_eligibility import effective_category, order_category, driver_constraints, profile_exclusion_reasons
from app.services.expiration_notification_worker import expiration_stage
from app.api.service_cities import DriverCitiesIn, ServiceCitiesIn

def test_category_resolution_and_explicit_category_precedence():
    inherited, explicit = uuid4(), uuid4()
    vehicle = SimpleNamespace(transport_category_id=None, delivery_option=SimpleNamespace(transport_category_id=inherited))
    assert effective_category(vehicle) == inherited
    vehicle.transport_category_id = explicit
    assert effective_category(vehicle) == explicit
    assert effective_category(None) is None
    assert order_category(SimpleNamespace(transport_category_id=None, delivery_option=None)) is None

@pytest.mark.parametrize('automatic', [True, False])
def test_dispatch_constraints_never_lose_city_category_or_conflict_checks(automatic):
    order = SimpleNamespace(id=uuid4(), city_id=uuid4(), transport_category_id=uuid4())
    sql = str(driver_constraints(order, automatic=automatic).compile(dialect=postgresql.dialect()))
    for expected in ('cities.is_active', 'vehicles.transport_category_id', 'order_offers.expires_at', 'orders.driver_id', 'drivers.is_active', 'users.is_active'):
        assert expected in sql
    assert ('drivers.is_on_shift' in sql) is automatic

@pytest.mark.parametrize('hours, expected', [(73, None), (72, '3days'), (25, '3days'), (24, '1day'), (1, '1day'), (0, 'expired'), (-1, 'expired')])
def test_placement_reminder_boundaries(hours, expected):
    now = datetime.now(UTC)
    assert expiration_stage(now + timedelta(hours=hours), now) == expected

def test_only_driver_city_contract_accepts_unassigned():
    assert DriverCitiesIn(city_ids=[]).city_ids == []
    with pytest.raises(ValueError): ServiceCitiesIn(city_ids=[])
    city_id = uuid4()
    with pytest.raises(ValueError): DriverCitiesIn(city_ids=[city_id, city_id])

def test_unassigned_driver_exclusion_explains_onboarding():
    driver = SimpleNamespace(city_ids=[], is_active=True, status='available', is_on_shift=True,
        is_auto_dispatch_enabled=True, is_dispatch_eligible=True, moderation_status='approved', vehicle=None)
    assert profile_exclusion_reasons(driver) == ['city_missing', 'vehicle_missing']
