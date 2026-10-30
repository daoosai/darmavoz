# Спринт 26 — отчёт тестового выпуска, 30.10.2026

**Статус: тестовый backend/web/APK `c3a8a294` опубликован и проверен.** Полная приёмка спринта не объявляется завершённой: физическое устройство недоступно, коммерческие условия требуют утверждения.

## Сборка и контур

- Web: https://test.darmavoz.ru/app.
- Code release: `c3a8a29431fc247417b593fa6c34a391d5a7ca50`, ветка develop. Последний шаг содержит исправления адаптивности и слоёв карты после визуальной проверки.
- APK: [Дармавоз ТЕСТ](https://test.darmavoz.ru/static/darmavoz-test-c3a8a29431fc247417b593fa6c34a391d5a7ca50.apk). Package `ru.darmavoz.app.test`, версия **3.3.3**, versionCode **391**. Версия и build number не повышались.
- APK: 19 870 463 байта, SHA256 `a1c571b65ee957bae23aa4c262c51f29759db6f29e83e584b9f6d8007402c0d6`. Проверены скачанный файл, бинарный manifest, Capacitor test identity, скомпилированный testAPI и отсутствие серверных секретов. Встроенного маркера commit в JS нет: идентификация по immutable имени, CI manifest и SHA256. [Проверка APK](android-artifact.json).
- Runtime: `/opt/darmavoz_test_deploy`, backend_test; фактические image/start/SHA/schema/flags — [проверка развёртывания](test-deployment.json). Runtime git и root web build-info соответствуют c3; image `sha256:7544b2bf6b2de6165e2722961dbf564eb04ed7c2cae1e8b9ae727dfb1f54c27b`, start2026-10-30T14:34:11Z, restart0. Последующий docs/ops commit может быть новее runtime и не требует пересборки.
- [Test deploy CI](https://github.com/daoosai/darmavoz/actions/runs/41071285103), [Test APK CI](https://github.com/daoosai/darmavoz/actions/runs/41071285089). Production workflows не запускались.

## Реализация 26.1–26.7

| Этап | Что работает | Проверка и основные файлы |
| --- | --- | --- |
| 26.1 | Additive schema, перенос подтверждённых сроков без нового trial, legacy review и изолированная проверка миграций | `alembic/versions/s26_subscription_platform.py`, `subscription_transition.py`; [clone round trip](migration-clone.json) |
| 26.2 | Подписка account/category для8категорий, явные14дней, HMAC контакта, реестр каждой машины, mixed fleet/driver↔carrier, тарифы/сроки/споры/админка | `subscriptions.py`, `app/api/subscriptions.py`, SubscriptionsScreen/AdminSubscriptionsScreen; границы/повторы/concurrency/backend и responsive browser |
| 26.3 | Оплата только подписок; snapshot/idem/durable jobs, provider GET/webhook/recovery/renewal; технические partial/full refunds и отдельное решение по source grant | `subscription_billing.py`, `sprint26_worker.py`; sandbox3покупки/2возврата, restart/replay, ниже; новые order-payment API запрещены, старая финансовая история сохранена |
| 26.4 | Public map после expiry, скрытые контакты, gates pricing/checkout/manual assign/offer accept, quarry-only auto/manual storage,120s handoff/60s retry, завершение назначенного рейса | capabilities существующих endpoints, dispatch admission; [resource smoke](live-resources.json), [два заказа на actual test DB/Redis](live-orders.json) |
| 26.5 | Только платная вода: формы/API/DB constraints, backup/preview/dependencies/cleanup, коммерческий reparse/staging | water endpoints/forms и scripts; [cleanup](water-cleanup.json), [import](water-import.json), [repeat](water-import-repeat.json), [legacy catalog archive](legacy-water-material.json) |
| 26.6 | Общий чат по доступу, polling/history/cursor/idem/offline, expiry во время использования, полный набор модерации/правила/pins/audit | `general_chat.py`, GeneralChatScreen; backend, isolated browser и [опубликованный test UI](live-ui-profiles-chat-journey.json) |
| 26.7 | Anonymous visitor/session/attempt и verified link, серверная истина заказа/платежа, очередь событий/RBAC/contacts/city/idle/owner outbox, админская хронология, получение/отзыв | `journey.py`, `journey_middleware.py`, `journey.ts`, AdminJourneysScreen, OrderReviewPanel; [owner](live-ui-owner.json), [client](live-ui-client.json) |

Подробный актуальный checklist/решения/продолжение — [SPRINT_26.md](../../SPRINT_26.md). Коммерческие цены не публиковались как утверждённые:32draft плана, в carrier неизвестная цена `null`; тестовые планы отделены. Нет автосписаний и store billing.

## Миграции и данные

Применена только тестовая миграция **s26_subscription_platform** (parent `release_317_merge_heads`):18новых таблиц и дополнительные поля vehicle/order. Пять S26 flags включены на тесте. Перенесены17подтверждённых grants;17неподтверждённых ресурсов оставлены для review,68невалидных исторических тестовых номеров не получили придуманный trial.

До изменения данных сохранён полный приватный pg_dump; restore catalog проверен. На disposable clone выполнены upgrade/transition/downgrade/re-upgrade: исторические127orders/9payments/2refunds и связанные таблицы совпали по digest. Реальная финансовая история на тесте по-прежнему содержит9старых платежей/2возврата.

Удалены6free water_points и5media metadata после preview SHA/dependency check; S3 объекты сохранены для восстановления. Импорт2GIS создал52коммерческих кандидата; повтор дал0created/52updated. Все52с неизвестной ценой остаются inactive/pending_moderation/auto_added и не попадают в public API. Старые4валидные платные точки сохранены, добавлена отдельная QA-точка. Финальная визуальная проверка выявила ещё активный legacy материал «Бесплатная вода» с одним0₽offer; он и связь архивированы с отдельной проверенной backup, без удаления/пересчёта истории.

## Финансовая проверка без реальных списаний

- Реальный тестовый магазин ЮKassa:3успешных покупки подписки. Pending пережил реальное force-recreate backend_test с прежними operation/provider/idempotence IDs и без преждевременного grant.
- Частичный возврат3₽из10₽: provider succeeded, осталось7₽; в UI явное keep только source grant. Полный1₽из1₽: succeeded, отдельное revoke только последнего source grant. Независимый и предыдущий доступ сохранён. [Partial](sandbox-refund.json), [full](sandbox-full-refund.json).
- Повторные webhook подтверждены server-side GET у провайдера; повтор payment request не создаёт новую операцию. Итог3payments/2refunds/1revoked source,3succeeded attempts,2renewal audits/events; replay не изменил grants. [Ledger](live-sandbox-ledger.json).
- Реальная тестовая карточная попытка показала «Не хватает денег», но hosted checkout оставил parent **pending** для повторного способа оплаты. После test wallet тот же платёж завершился успешно. **Окончательный live canceled от банка не получен**; terminal rejection/user cancel/owner classification/late binding проверены backend-тестами. [Наблюдение](sandbox-card-attempt.json).
- Первоначальный partial0,40₽из1₽ был отклонён HTTP400/amount.value. Добавлена техническая граница до постановки job: refund>=1₽, остаток0или>=1₽. Это ограничение API, не утверждение коммерческой политики. [Диагностика](sandbox-provider-limit.json).

## Проверки

- Последняя CI **c3:284 backend passed (88.60s),172 Playwright passed (6.9m)**; npmrunlint/TypeScript/frontend build passed. Оба test workflows success; точные данные — [CI](ci-final.json).
- После последних layoutfix: **10 isolated browser passed (1.8m)**, отдельно6resource backend passed15.65s, npmrunlint(=tsc --noEmit)/frontend build passed. Один запуск preview без API proxy вернул SPAHTML; после исправления тестового окружения все10прошли. [Follow-up](map-layout-followup.json).
- Actual test ASGI handlers+DB/Redis:2полных QA-заказа10м³×1₽+delivery0, idem retry, запрещённый старый payment endpoint, manual assign gate, trial driver/carrier,6статусов после expiry, освобождение водителя, received/review, separate chains. CLI notification transport ограниченQA:108non-QA отправок подавлено,68jobs толькоQA. Это API E2E, **не доказательство оформления заказа кликами от начала до конца в опубликованном web**.
- Published web: чат/send/offline/pin/delete/warn, anonymous failed login→verified login/history/city/maskedcontact/auditedreveal/dedup,3ошибки→1ownerin-app после5минут и рабочая ссылка, клиентское получение/отзыв/direct notice. Уведомления толькоQA.
- Полный историческийpytest не объявляется зелёным: старые sprint18relevance/dispatch fixtures воспроизведены на чистом907182ae; новыеS26и CI checks проходят. Контекст — [предыдущая передача](checkpoint-history.md).

## Вёрстка и визуальная проверка

Размеры360×800,390×844,768×1024,1024×768,1440×900,844×390; дополнительные короткие viewport390×420 для имитации клавиатуры. Использованы существующие компоненты/цвета/типографика/карточки/кнопки. Просмотрены новые подписки/админка/чат/модерация/аналитика/водная форма/refund/получение и затронутая карта.

Исправлены белый текст кнопки карты на белом фоне, перекрытие embedded toolbar zoom-контролом, верхний предел карты в landscape, слоиSDK/locator поверх storage card, clipped water/septic sheets. Новые hit tests проверяют границы карточки, достижимость контактов прокруткой и получение pointer events кнопками close/route/contact.

Опубликованный profiles helper прошёл42кадра с geometry/scroll/hit checks и строгой проверкой sticky close без возвратной auto-scroll. Дополнительно все вкладки admin UI —1passed32s. [Visual report](visual-review.json).

[Индекс контрольных снимков](screenshots/README.md). Изолированные screenshot tests и опубликованный web различаются в индексе. Browser viewport/короткий экран не доказывают настоящую клавиатуру/safe-area/PUSH на Android.

## Осталось и ограничения приёмки

1. **Физического устройства/adb нет:** установка/работаAPK, реальная Android-клавиатура/insets/поворот/WebView/PUSH foreground/background/terminated не подтверждены. Driver/Client SMS требуют контролируемого QA-телефона; тестовые JWT этих профилей не заменяют обычный вход.
2. Реальный terminal bank canceled не получен (parentpending), изолированная ветка проверена. Полный click-through checkout на опубликованном web остаётся отдельной ручной проверкой, API E2E выполнен.
3. До production заказчик подтверждает тарифы, в особенностиequipment/carrier, коммерческие правила полного/частичного refund и изменения доступа, чеки/VAT/legal/privacy/retention, спорных владельцев и номеров.52водных кандидата требуют подтверждения цен/контактов перед публикацией.

[Точные шаги ручной приёмки](MANUAL_ACCEPTANCE.md). Проверять на выделенныхQA-аккаунтах/устройствах, без настоящих платёжных инструментов и уведомлений реальным клиентам.

## Сохранность production

Production main/DB/миграции/данные/контейнеры/конфиги не изменялись, production workflows не запускались. Read-only сравнение image/start/restart count и обоих.env с baseline: [сверка](production-unchanged.json), [runtime probe](test-deployment.json). Серверные.env и версия приложения не менялись. Чужие незакоммиченные документы сохранены.

## Коммиты приложения

- [6a7b95f1](https://github.com/daoosai/darmavoz/commit/6a7b95f1b4b0110369591324b20912a8a28b330e) — feat: implement Sprint 26 subscription platform and client journey foundation.
- [c07d678e](https://github.com/daoosai/darmavoz/commit/c07d678e2fcfbd997a1dc71283db9c9c53ccb7c4) — fix: close Sprint 26 access gaps and prepare isolated test release.
- [28a7b5ae](https://github.com/daoosai/darmavoz/commit/28a7b5aee57378a0087aedf4fa2df555f15643c9) — fix: retain journey city and reconcile subscription retry attempts.
- [3adda8ba](https://github.com/daoosai/darmavoz/commit/3adda8ba43efa4fb8f58c40917bb8440989eda19) — fix: validate subscription refund amounts against YooKassa limits.
- [0fd8dd19](https://github.com/daoosai/darmavoz/commit/0fd8dd199e4e0b3257ad9c931a6f3f014dc67440) — fix: keep subscription map controls readable across screen sizes.
- [a378dc58](https://github.com/daoosai/darmavoz/commit/a378dc58f7e47ab7657c73ad792fe0ca12982d14) — fix: preserve public resource redaction and distinguish subscription bank declines.
- [49b5a050](https://github.com/daoosai/darmavoz/commit/49b5a050c41cb6c8cb59effe9e34c94267524e0f) — fix: keep pending subscription recovery separate from payment rejection.
- [c3a8a294](https://github.com/daoosai/darmavoz/commit/c3a8a29431fc247417b593fa6c34a391d5a7ca50) — fix: keep public map cards usable across viewport sizes.
