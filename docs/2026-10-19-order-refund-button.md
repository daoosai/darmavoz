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
Проверки и доставка фиксируются после выполнения. Реальный возврат #B6A576 не выполнять.

Локальные проверки: npm run lint — PASS; tests/test_refunds.py — 48 passed (одноразовая БД/mock ЮKassa); Playwright order-refund-modal + logist-refund-attention + refunds + client-refund-info — 27 passed (390/1440 px). Мобильная форма просмотрена визуально. git diff --check — PASS.
