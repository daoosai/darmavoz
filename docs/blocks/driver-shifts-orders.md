# Смена и назначенные заказы водителя

Контур: develop / test.darmavoz.ru.

DriverOrdersScreen управляет сменой через PATCH /driver/profile/shift.
Геолокация и смена независимы: ошибка, отсутствие GPS или отказ разрешений
при «Продолжить» закрывает disclosure и запрашивает начало смены.
Tracking включается только при полученном разрешении; при ошибке Web после
успешного PATCH показывается soft toast
«Фоновая геопозиция недоступна в браузере, но смена начата».
На native отказ/исключение также не мешает смене. Ошибка PATCH не
включает тумблер и не выдаёт сообщение об успешном начале смены.
Отмена disclosure не начинает смену. Повторный клик «Продолжить» блокируется
на время операции.

Назначения читаются независимо от is_on_shift через
GET /driver/orders/assigned/current, с fallback GET /driver/orders.
В текущем backend сервисы get_current_assigned_order_for_driver /
list_orders_for_driver уже выбирают заказы по driver_id, без фильтра смены.
UI также не фильтрует их по смене; это закреплено API и браузерными тестами.
Проверки авторизации/модерации и допуск к новым автоназначениям сохранены.
Смена по-прежнему нужна driver_eligibility для новых автоматических заказов.

Файлы: frontend/src/DriverOrdersScreen.tsx, useDriverLocationTracking.ts,
DriverProfileScreen.tsx; app/api/driver_dispatch.py,
app/services/dispatch_service.py, driver_locations.py, driver_eligibility.py.
Регрессии: frontend/tests/e2e/driver-shift-orders.spec.ts и
tests/test_driver_order_route_fields.py (on/off shift).
Они включены в deploy-test. Дополнительно запускаются тесты телеметрии.
Отчёт: ../2026-10-14-driver-shift-orders.md.

Ограничение: физические Android/iOS устройства не проверяются браузерным
spec; отсутствие GPS не означает наличие фонового tracking.
