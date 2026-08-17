import asyncio

from sqlalchemy import select

from app.db.database import AsyncSessionLocal
from app.models.models import Driver, DriverStatus, Order
from app.services.dispatch_service import ACTIVE_ASSIGNED_ORDER_STATUSES


async def main() -> None:
    updated_to_busy = 0
    updated_to_offline = 0

    async with AsyncSessionLocal() as db:
        active_driver_ids = set(
            (
                await db.scalars(
                    select(Order.driver_id)
                    .where(Order.driver_id.is_not(None))
                    .where(Order.status.in_(sorted(ACTIVE_ASSIGNED_ORDER_STATUSES)))
                )
            ).all()
        )
        drivers = list((await db.scalars(select(Driver).order_by(Driver.id))).all())

        for driver in drivers:
            if driver.id in active_driver_ids:
                if not driver.is_on_shift or driver.status != DriverStatus.busy.value:
                    updated_to_busy += 1
                driver.is_on_shift = True
                driver.status = DriverStatus.busy.value
            else:
                if driver.is_on_shift or driver.status != DriverStatus.offline.value:
                    updated_to_offline += 1
                driver.is_on_shift = False
                driver.status = DriverStatus.offline.value

        await db.commit()

    print("Актуализация статусов водителей v2.9.0 завершена.")
    print(f"Всего водителей обработано: {len(drivers)}")
    print(f"Водителей переведено в busy: {updated_to_busy}")
    print(f"Водителей переведено в offline: {updated_to_offline}")


if __name__ == "__main__":
    asyncio.run(main())
