# Web-смена и видимость назначений — 14.10.2026

Контур /opt/darmavoz_test, develop. Исправление:
- Геолокационные исключения/отказ больше не прерывают начало смены;
  модалка закрывается, tracking зависит от разрешения, смена — от PATCH.
- Soft toast после успешного PATCH; при ошибке сервера успех не показывается.
- Отмена и повторный клик обработаны.
- Чтение назначений уже не зависело от смены: лишних фильтров в API/UI
  не обнаружено. Добавлены регрессии обоих API-путей, on/off shift,
  оплаченного назначения и сохранения карточки после выключения смены.
  Production-данные и правила новых автоматических назначений не менялись.

Блок: blocks/driver-shifts-orders.md.
Проверки на ноде:
- npm run lint — успешно.
- npm run build — успешно.
- driver-shift-orders.spec.ts — 12 passed (390/1440px, GPS granted/denied/
  unsupported, current/list, отмена, ошибка PATCH, выключение смены).
- pytest test_driver_order_route_fields.py + test_driver_location_telemetry.py —
  4 passed; временная БД создаётся/удаляется, рабочие заказы не меняются.
  Тест задания проверяет оба endpoint до и после включения/выключения смены.
Первый параметризованный вариант фикстуры столкнулся с повторным username;
заменён последовательным переключением одного назначения в одной фикстуре.

Итог:
- Commit 020d6f20: fix: allow shift toggle on web and always show assigned orders to driver.
- Push develop успешен.
- Deploy Test Environment 38520837374 — success.
- Build Test Android APK 38520837425 — success.
- Runtime /opt/darmavoz_test_deploy — 020d6f20; backend_test пересоздан,
  GET https://test.darmavoz.ru/health — online, версия 3.3.6.
- Повтор на опубликованном frontend: driver-shift-orders.spec.ts — 12 passed.
  API перехватывается; реальные заказы и смены не изменялись.
- Скриншоты 390/1440px сохранены в docs/reports/2026-10-14-driver-shift-orders/;
  mobile визуально просмотрен: тумблер активен, soft toast отображается.
- В test БД не найдено активных назначенных заказов; исходный случай QA
  на конкретном реальном заказе не воспроизведён. Независимость от смены
  подтверждена API-тестом во временной БД и браузерными фикстурами.
- .env, версии и production не менялись. Физические устройства не проверялись.
