# Начальный статус заказа клиента — 14.10.2026

Контур: /opt/darmavoz_test, develop, test.darmavoz.ru.

Исправлен общий statusMapper карточки и прогресс-бара: до подтверждённой
стоимости/платежа ранние статусы показывают «Заказ оформлен» и
«Ожидает проверки логистом», прогресс 10%. После проверки сохранён
приоритет оплаты, после оплаты — поиск или назначение водителя.
Серверные статусы и платежная логика не менялись.

Файлы: frontend/src/utils/statusMapper.ts, store.ts, OrdersScreen.tsx,
FloatingOrderTracker.tsx; frontend/tests/e2e/client-order-card.spec.ts.
Описание блока: blocks/client-orders.md.

Проверки на ноде: npm run lint и npm run build успешны.
Первый браузерный прогон: 31 passed; два теста гипотетического статуса new
выявили отсутствие new в activeStatuses. Добавлен active status; после
исправления выполнены повторные lint/build и адресный прогон двух тестов — 2 passed.
Проверены 25 сценариев карточки/трекера и 8 сценариев результата оплаты.
Фактическая доставка и результат повторной проверки будут дополнены после push.

Итог: commit 58bc3822, push develop успешен.
Deploy Test Environment 38519572374 — success.
Build Test Android APK 38519572381 — success.
Runtime /opt/darmavoz_test_deploy — 58bc3822; GET /health — online, 3.3.6.
На опубликованном сайте client-order-card.spec.ts — 25 passed.
Реальный заказ 143dff21-974c-4405-aa91-6728821b79f5 (no_driver_found,
без quote) проверен только чтением на 390/1440px: карточка и трекер
показывают новые тексты и 10%; мобильный скриншот визуально просмотрен.
Результат — docs/reports/2026-10-14-client-initial-status/live-readonly.json,
скриншоты рядом на ноде. Первый запуск совпал с перезапуском backend
при CI и был повторён после health online. Никакие заказы/платежи не
создавались и не изменялись. .env, версии, production не менялись.
Физическое мобильное устройство не проверялось.
