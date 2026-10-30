# Спринт 26: подписки, прямые расчёты и контроль пути

Актуальная передача/решения/checklist/продолжение: [SPRINT_26.md](../SPRINT_26.md). [Отчёт тестового выпуска](../reports/sprint26/TEST_RELEASE.md), [ручная приёмка](../reports/sprint26/MANUAL_ACCEPTANCE.md), [скриншоты](../reports/sprint26/screenshots/README.md). Старый [план](../sprint26-plan.md) и progress сохранены как история.

На test опубликован app release **c3a8a294**: backend/web/прямой Android APK, версия3.3.3/code391 без повышения. Только develop/test; production/main/.env не изменялись. Полная приёмка открыта: физического устройства/SMS QA-получателя нет, commercial условия требуют утверждения.

## Что реализовано

- Account/category подписки для8существующих категорий, явные14дней, реестр контакта/каждой машины, сохранение прежних сроков, driver↔carrier/mixed fleet, тарифы/спорные случаи/ручной доступ/аудит.
- Только подписная онлайн-оплата; новые заказы с прямыми расчётами, старые платежи/возвраты сохранены. Durable jobs/idempotence/provider GET/webhooks/recovery/renewal и технические refunds с отдельным source-grant решением.
- Серверные gates новых заявок/контактов/manual assign/accept; принятый рейс можно завершить после expiry. Auto quarry/manual accumulator,120s handoff и60s retry. Approved expired точки остаются серыми без контактов/нового заказа; скрытые CRM не раскрываются.
- Только платная вода: формы/API/DBcheck, backup/preview/dependencies/cleanup6точек, reparse52кандидатов в moderation до подтверждения цены. Legacy free-water материал и один0₽offer архивированы отдельно без удаления истории.
- Общий чат по доступу, offline/retry/expiry и полная модерация/rules/pins/audit. Anonymous journey/verified link/server truth/contact RBAC/owner outbox/админская хронология, клиентское получение и отзыв.
- Текущий дизайн сохранён.6размеров/поворот/короткийviewport; исправлены контраст и слои/landscape/прокрутка карточек карт.

## Основные файлы и API

`app/models/subscriptions.py`, `alembic/versions/s26_subscription_platform.py`; services `subscriptions.py`, `subscription_billing.py`, `subscription_transition.py`, `sprint26_worker.py`, `journey.py`, `journey_middleware.py`; API `/api/v1/subscriptions`, `/api/v1/chat`, `/api/v1/admin/journeys` и gates существующих endpoints. Frontend: CommerceShell, SubscriptionsScreen, AdminSubscriptionsScreen, GeneralChatScreen, AdminJourneysScreen, OrderReviewPanel, DriverSubscriptionNotice/PublicCatalogMap, journey.ts.

## Проверки и ограничения

CI c3: **284 backend /172 Playwright passed**, lint(TypeScript)/build success. Отдельно10isolatedbrowserpass1.8m, расширенныйadmincase1pass32s,6resourcebackendpass. Изолированный migration roundtrip сохранил исторические данные. ActualtestAPIE2E2QAзаказов, live sandbox3покупки/2возврата/restart/replay, published chat/journey/owner/client и42map/card captures. Все отчёты связаны из release report.

Live terminal bank canceled не получен (parentpending); эта ветка проверена isolated. Полный checkout кликами в publishedweb остаётся ручной проверкой; API flow выполнен наactualtestDB. APKbuild/browser/no_device не доказывают физический PUSH/WebView/keyboard. До production: утвердить тарифы/equipment/carrier/refund-access/legal/retention и модерацию52водных кандидатов. Тестовые цены отделены, carrier неизвестная цена `null`, не0. Автосписаний/storebilling нет.
