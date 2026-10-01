"""Shared hard constraints; geography only changes ranking, never admission."""
from datetime import datetime, UTC
from sqlalchemy import and_, exists, func, select
from app.models.models import City, DeliveryOption, Driver, Order, OrderOffer, User, Vehicle

ACTIVE_STATUSES = ('driver_assigned', 'driver_accepted', 'heading_to_pickup', 'arrived_at_pickup', 'loading', 'heading_to_client', 'delivered')

def effective_category(vehicle):
    if vehicle is None:
        return None
    option = getattr(vehicle, 'delivery_option', None)
    return getattr(vehicle, 'transport_category_id', None) or getattr(option, 'transport_category_id', None)

def order_category(order):
    option = getattr(order, 'delivery_option', None)
    return getattr(order, 'transport_category_id', None) or getattr(option, 'transport_category_id', None)

def category_match_clause(order):
    from app.models.models import DeliveryOption
    category_id = order_category(order)
    if category_id is None:
        return False
    inherited = select(DeliveryOption.transport_category_id).where(DeliveryOption.id == Vehicle.delivery_option_id).scalar_subquery()
    return func.coalesce(Vehicle.transport_category_id, inherited) == category_id

def driver_constraints(order, *, automatic=True):
    physical_capacity = func.coalesce(Vehicle.body_volume_m3, Vehicle.cubature_max, select(DeliveryOption.capacity_m3).where(DeliveryOption.id == Vehicle.delivery_option_id).scalar_subquery())
    constraints = [physical_capacity > 0, Driver.is_active.is_(True), Driver.status == 'available',
        (Driver.user_id.is_(None) | exists(select(User.id).where(User.id == Driver.user_id, User.is_active.is_(True), User.is_deleted.is_(False)))),
        Driver.moderation_status.in_(('approved', 'incomplete')), Vehicle.is_active.is_(True),
        Vehicle.moderation_status.in_(('approved', 'incomplete')), category_match_clause(order),
        exists(select(City.id).where(City.id == getattr(order, 'city_id', None), City.is_active.is_(True))),
        ~exists(select(Order.id).where(Order.driver_id == Driver.id, Order.id != getattr(order, "id", None), Order.status.in_(ACTIVE_STATUSES))),
        ~exists(select(OrderOffer.id).where(OrderOffer.driver_id == Driver.id, OrderOffer.order_id != getattr(order, "id", None),
            OrderOffer.status == 'pending', OrderOffer.expires_at > func.now()))]
    if automatic:
        constraints.extend((Driver.is_on_shift.is_(True), Driver.is_auto_dispatch_enabled.is_(True), Driver.is_dispatch_eligible.is_(True)))
    return and_(*constraints)

def profile_exclusion_reasons(driver):
    reasons = []
    if not getattr(driver, 'city_ids', []): reasons.append('city_missing')
    if not driver.is_active: reasons.append('driver_inactive')
    if driver.status != 'available': reasons.append('status_' + str(driver.status))
    if not driver.is_on_shift: reasons.append('shift_off')
    if not driver.is_auto_dispatch_enabled: reasons.append('auto_dispatch_disabled')
    if not driver.is_dispatch_eligible: reasons.append('dispatch_admission_denied')
    if driver.moderation_status not in ('approved', 'incomplete'): reasons.append('driver_moderation_' + str(driver.moderation_status))
    vehicle = driver.vehicle
    if vehicle is None: reasons.append('vehicle_missing')
    else:
        if not vehicle.is_active: reasons.append('vehicle_inactive')
        if vehicle.moderation_status not in ('approved', 'incomplete'): reasons.append('vehicle_moderation_' + str(vehicle.moderation_status))
        if effective_category(vehicle) is None: reasons.append('category_missing')
        if not any((getattr(vehicle, 'body_volume_m3', None), getattr(vehicle, 'cubature_max', None), getattr(getattr(vehicle, 'delivery_option', None), 'capacity_m3', None))): reasons.append('volume_missing')
    return reasons
