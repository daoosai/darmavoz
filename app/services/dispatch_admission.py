from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.models.models import Driver, Vehicle
from app.services.cities import ensure_driver_city, resolve_city
from app.services.driver_eligibility import driver_constraints

async def admit_driver(session, order, driver_id, *, automatic=True):
    await session.execute(select(Driver.id).where(Driver.id == driver_id).with_for_update())
    driver = await session.scalar(select(Driver).options(selectinload(Driver.vehicle).selectinload(Vehicle.delivery_option)).where(Driver.id == driver_id).execution_options(populate_existing=True))
    if driver is None:
        raise HTTPException(404, 'Водитель не найден')
    await resolve_city(session, order.city_id)
    await ensure_driver_city(session, order, driver_id)
    if not await session.scalar(select(Driver.id).join(Driver.vehicle).where(Driver.id == driver_id, driver_constraints(order, automatic=automatic))):
        raise HTTPException(409, 'Водитель недоступен, занят или категория машины не соответствует заказу')
    from app.services.dispatch_service import ensure_driver_vehicle_matches_order_volume
    ensure_driver_vehicle_matches_order_volume(order, driver)
    return driver
