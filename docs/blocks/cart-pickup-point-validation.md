# Подбор точек в корзине

POST /api/v1/client/orders/calculate выбирает публичные карьеры с активным материалом и ценой по city_id. resolve_delivery_city разрешает населённый пункт без собственной настройки доставки в ближайший активный настроенный рынок по координатам (100 км). Город со своими тарифами/прайсами сохраняет собственный scope. При создании адреса, calculate и checkout применяется одинаковый resolver. Pickup-points принимает lat/lon доставки для нормализации, запрос без координат сохраняет city_id. Фильтры CRM, модерации и срока размещения не ослаблены.

Файлы: app/services/cities.py, order_pricing.py, dispatch_service.py, app/api/cities.py, client_addresses.py, pickup_points.py. Проверки: tests/test_suburban_delivery_city.py. Отчёт: ../2026-10-12-suburbs-cart-map.md.
