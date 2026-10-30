# Sprint 26 progress / handover

Статус: IMPLEMENTING. Не готов к приемке/релизу.

## 2026-10-30 начало
- Нода foptyvllka, source /opt/darmavoz_test develop 907182ae совпадает с origin.
- Сохранены существующие изменения docs/README.md, blocks/logist-drivers.md, blocks/refunds.md и untracked диагностика.
- Baseline содержит hashes .env и production container metadata; значения секретов не выводятся.
- Проверены инструкции и test workflows; main/prod не изменяются.
- План и уточнения: sprint26-plan.md.

## Этапы
- 26.1: in progress — документация/baseline созданы, миграции впереди.
- 26.2–26.7: pending.
- Checks/deploy/APK: pending.

## Следующее действие
Новые ORM модели subscription/trial/grant/payment/refund/chat/journey/settings и additive Alembic revision. Затем сервисы и адресные тесты в disposable PostgreSQL.

## Ограничения
Физическое устройство не обнаружено/не проверено. Боевые цены и коммерческие правила возврата не утверждены. Не считать разработку, тесты и delivery выполненными до записи фактического результата.

## 2026-10-30 рабочее продолжение (до первого commit/deploy)
- Добавлена additive migration s26_subscription_platform (18 таблиц), модели, category access/trial/contact/plate ledgers, планы-черновики, admin API.
- Изолированные QA Postgres/Redis: s26_qa_postgres / s26_qa_redis, без host ports; runner /tmp/s26-qa-run.py использует fake shop, отключенные SMS/FCM. Рабочая БД не мигрирована.
- Empty isolated DB upgrade head успешен. Изменения frozen DDL после этого проверены на fresh disposable pytest DB.
- Адресные pytest: test_sprint26_subscriptions.py + test_sprint26_chat_journey.py: 23 passed, 4 warnings (15.13s). Не является полной приемкой.
- Реализованы durable subscription payment/refund jobs, source grant adjustment, test/amount/recipient verification; подключены worker/lifespan и subscription webhook routing (последние изменения еще требуют отдельных provider race/restart tests).
- Chat API: gates on every operation, idempotent send, moderation, rules/pins/change cursor/audit. Chat tests: expiry, sanctions, moderator expiry, no duplicate messages.
- Journey API/service/middleware: anonymous events, encrypted/masked contacts, verified actor link, server event markers, idle/late-success, owner outbox/settings. Tests reject client success/secrets and verify RBAC/dedupe.
- SQL echo отключен для исключения утечки bind values.
- Начаты central gates: driver eligibility, direct order payment protection, point selection/pricing visibility split; equipment/water/septic public serialization masks contacts. Последний блок еще не покрыт адресными тестами.
- Frontend SubscriptionsScreen, GeneralChatScreen используют CommerceShell/commerceApi; CommerceMenu связывает их с существующими кабинетами. npm run lint прошел до последующих backend-only правок. Browser/visual/E2E еще НЕ выполнены.
- Нет commit/push/deploy; production/.env/version/build не менялись. Чужие исходные dirty docs сохранены.

### Следующие обязательные работы
1. Добавить tests central gates, provider webhook/restart/external refunds; явное решение доступа после уже выполненного refund в admin API/UI. Проверить старые backend tests/migration heads.
2. Довести backfill confirmed legacy terms/ownerless grants, trial backfill и plate normalization, manual assign/accept/point checks, dispatch retry и accepted completion.
3. Paid-water DB guard/migration, frontend removal free options, backup/dry-run/dependencies cleanup/reparse paid staging на тесте.
4. Admin subscriptions/plans/grants/refunds/settings/disputes UI; journey dashboard/settings, frontend instrumentation/offline queue; direct-order payment UI; received/review UI.
5. Проверить все public surfaces на contact leaks; capabilities UI gray points/disable equipment actions; navigation for all partner roles; chat moderation live expiry.
6. Полный isolated migration upgrade/downgrade, backend tests, TypeScript/build, Playwright и visual 360/390/768/1024/1440/orientations; тестовый shop E2E, test deploy/API/APK.
7. Stage only own files (docs/README mixed dirty!), commit develop, review test workflows before push, check delivered SHA/artifact, compare baseline production/env hashes, screenshots/release report.
