# Возврат из карточки заказа для логиста — 19.10.2026

Контур: develop, /opt/darmavoz_test, test.darmavoz.ru. Production, .env, версии и финансовые данные не меняются.

Причина: жёлтая плашка в LogistDashboardScreen была только информационной. Форма ручного возврата существовала в FinanceScreen, а OrderPaymentsPanel в карточках не предоставлял действие. Ограничения admin-only не было: POST /api/v1/payments/{payment_id}/refund использует get_current_logist_user = require_roles("admin", "logist").

Изменения:
- Общая жёлтая плашка с заметной кнопкой «Оформить возврат» перенесена в OrderPaymentsPanel и подключена в карточках logist/admin.
- OrderRefundModal открывает нативный modal dialog с удержанием фокуса; читает актуальные платежи заказа, выбирает succeeded с доступным остатком и без текущей обработки возврата. При нескольких подходящих платежах есть выбор.
- Частичная сумма от 0.01 до доступного остатка, обязательная причина минимум 3 непустых символа, явное подтверждение суммы.
- POST использует существующий backend. При сетевом сбое форма и request_id сохраняются для повтора; повторные клики во время отправки блокируются.
- После 202 показывается «Возврат поставлен в очередь», обновляются платёжная карточка и список заказов/счётчик.
- Открытие/закрытие формы само по себе не создаёт возврат и не выполняет provider refresh.
- Финансовая бизнес-логика/RBAC backend не изменены; права admin/logist и отказ manager/driver закреплены изолированными тестами.

Файлы: frontend/src/OrderRefundModal.tsx, OrderPaymentsPanel.tsx, LogistDashboardScreen.tsx, AdminOrdersListScreen.tsx; tests/test_refunds.py; frontend/tests/e2e/order-refund-modal.spec.ts; .github/workflows/deploy-test.yml.
Итоговые проверки и доставка приведены ниже. Реальный возврат #B6A576 не выполнялся.

Локальные проверки: npm run lint — PASS; tests/test_refunds.py — 48 passed (одноразовая БД/mock ЮKassa); Playwright order-refund-modal + logist-refund-attention + refunds + client-refund-info — 27 passed (390/1440 px). Мобильная форма просмотрена визуально. git diff --check — PASS.

## Доставка и проверка опубликованного UI

Код 329d7851c9af2e16710962ac0cbea4079c290ec6 закоммичен с сообщением задачи и отправлен в origin/develop с ноды.
[Deploy Test Environment 39197966794](https://github.com/daoosai/darmavoz/actions/runs/39197966794) — success (полный backend и frontend regression, сборка и доставка).
[Build Test Android APK 39197966722](https://github.com/daoosai/darmavoz/actions/runs/39197966722) — success.
Runtime /opt/darmavoz_test_deploy и image backend_test проверены: 329d7851c9af2e16710962ac0cbea4079c290ec6. Внешний /health — online, версия прежняя 3.1.7.

На test.darmavoz.ru под настоящими ролями logist/admin на 390/1440 px открыт реальный отменённый #B6A576:
- в жёлтой плашке есть кнопка «Оформить возврат»;
- она открывает modal dialog, актуальный остаток и max суммы — 10.00;
- доступны частичная сумма 5.00, обязательная причина и подтверждение;
- форма помещается по ширине, закрывается кнопкой «Закрыть».
При проверке блокировались все не-GET API-запросы; POST /refund не выполнялся.
Повторный SELECT после браузера: cancelled; Payment succeeded 10.00; auto_refund_requested=false; refundable_amount=10.00; Refund count=0.
Настоящие платёж, отмена, возврат и уведомления не создавались/не изменялись.

[verification.json](reports/2026-10-19-order-refund-button/verification.json) содержит четыре успешных результата и refundPosts=0. Скриншоты card/modal-admin/logist-390/1440.png сохранены на ноде в docs/reports/2026-10-19-order-refund-button/ (в Git не добавлялись). Мобильная модалка реального заказа просмотрена визуально.
Реальная отправка возврата оставлена QA/логисту; незавершённых действий по коду и доставке нет.
