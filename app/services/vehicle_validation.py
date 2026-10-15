import math
from fastapi import HTTPException
from sqlalchemy import select
from app.models.models import TransportCategory

async def validate_vehicle_capacity(db, vehicle):
    for field in ('cubature_min', 'cubature_max', 'body_volume_m3', 'tonnage_min', 'tonnage_max'):
        value = getattr(vehicle, field, None)
        if value is not None and (not math.isfinite(value) or value <= 0):
            raise HTTPException(422, 'Кубатура и грузоподъёмность должны быть больше нуля')
    for low, high in (('cubature_min', 'cubature_max'), ('tonnage_min', 'tonnage_max')):
        a, b = getattr(vehicle, low, None), getattr(vehicle, high, None)
        if a is not None and b is not None and a > b:
            raise HTTPException(422, 'Минимальное значение не может превышать максимальное')
    if vehicle.transport_category_id:
        category = await db.get(TransportCategory, vehicle.transport_category_id)
        if category is None:
            raise HTTPException(422, 'Категория транспорта не найдена')
