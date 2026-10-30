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
    from app.services import subscriptions as policy
    if await policy.enabled(session) and order.quarry_id:
        from app.models.models import Quarry
        from app.services.pickup_points import pickup_point_orderable
        point=await session.get(Quarry,order.quarry_id)
        if not await pickup_point_orderable(session,point):
            raise HTTPException(409,{"code":"PICKUP_SUBSCRIPTION_REQUIRED","message":"Точка погрузки недоступна для новой доставки. Выберите другую точку"})
    if await policy.enabled(session) and driver.vehicle:
        allowed=driver.user_id and any([(await policy.access(session,driver.user_id,c,vehicle=driver.vehicle))["active"] for c in policy.TRANSPORT])
        if not allowed:
            raise HTTPException(409,{"code":"DRIVER_SUBSCRIPTION_REQUIRED","message":"Для новых заявок водителю нужна действующая подписка или пробный доступ этой машины. Принятый рейс можно завершить"})
    await resolve_city(session, order.city_id)
    await ensure_driver_city(session, order, driver_id)
    if not await session.scalar(select(Driver.id).join(Driver.vehicle).where(Driver.id == driver_id, driver_constraints(order, automatic=automatic))):
        raise HTTPException(409, 'Водитель недоступен, занят или категория машины не соответствует заказу')
    from app.services.dispatch_service import ensure_driver_vehicle_matches_order_volume
    ensure_driver_vehicle_matches_order_volume(order, driver)
    return driver
