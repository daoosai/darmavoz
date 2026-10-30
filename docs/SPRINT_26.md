# Спринт 26 — единый документ передачи и состояния работы

**Следующей сессии:** сначала прочитать этот файл, `/opt/darmavoz_test/AGENTS.md`, README и применимые `.github/workflows/` **на ноде**. Проверить `git status`, актуальные ветки и фактически запущенный тестовый контур. Затем продолжить с раздела **«Продолжить отсюда»**. Чужие и неизвестные изменения не перезаписывать, не сбрасывать и не включать в свои коммиты. История чата для продолжения не требуется.

Обновлено: 2026-10-30 UTC. Общий статус: **в работе; спринт не завершён; выпуск не готов к приёмке**. Этот документ — основной источник передачи работы. Старые `sprint26-plan.md` и `sprint26-progress.md` сохранены как контекст, но их промежуточные статусы могут отставать.

## 1. Цель и разрешённый объём

Перевести монетизацию на подписки восьми существующих категорий, сохранив каталог, расчёт стоимости, оформление, диспетчеризацию, статусы, историю и существующий дизайн. Добавить однократный 14-дневный trial, ограничения доступа, общий чат с модерацией, контроль пути посетителя/пользователя, подтверждение получения и отзыв. Довести полный объём 26.1–26.7 до работающего **тестового** web/backend и прямого тестового Android APK с самостоятельной проверкой.

**Главное бизнес-правило:** приложение принимает деньги только за подписки. В новых заказах покупатель рассчитывается с водителем напрямую наличными/переводом, водитель — с карьером/накопителем/поставщиком на своих условиях. Цены и расчёты остаются справочными для заказа. Исторические платежи и возвраты не удаляются и продолжают обслуживаться. Старый APK не должен обходить запрет созданием нового платежа за заказ.

Работать последовательно без согласования каждого этапа. Обычные технические решения принимать самостоятельно. Существенные неопределённости, которые нельзя разрешить по коду и этому документу, уточнять, продолжая независимые задачи. Оценка рабочих дней не основание откладывать или сокращать объём.

## 2. Обязательные ограничения

- Изменения кода, коммиты, push и проверки Дармавоза — строго на ноде заказчика `foptyvllka`: `ssh -F /opt/daoos/config/runner_ssh/config дармавоз`.
- Source: `/opt/darmavoz_test`, ветка `develop`. Runtime: `/opt/darmavoz_test_deploy`, `docker-compose.test.yml`, сервис/контейнер `backend_test`. Runtime не редактировать как исходники.
- Разрешены необходимые код, тестовые миграции/данные, сборки, develop push, тестовый deploy web/backend и прямого APK. **Production запрещён:** не изменять main, production DB/миграции/данные/контейнеры/настройки, не запускать production workflows. Не переносить в production автоматически.
- Серверные `.env` не редактировать. Версия **3.3.3**, Android build **391** остаются прежними; не запускать `version:sync`. Выпуск идентифицировать commit SHA + именем/хешем APK.
- Перед push и ручной автоматизацией проверить фактические триггеры workflows. Develop: `deploy-test.yml` и тестовая Android-сборка. Production `deploy.yml` запускается от успешного production Android workflow на main/вручную; его не вызывать. Повторно прочитать актуальные файлы перед действием.
- Не стирать чужой dirty code/docs. Не использовать force push. Авторизацию push проверять с ноды. Коммитить только изменения спринта.
- Дизайн сохранять: существующие цвета, шрифты, интервалы, карточки, кнопки, формы, модалки, иконки, навигация. Новые разделы используют CommerceShell/commerceApi и существующие стили, не отдельный визуальный язык.
- Вёрстка обязательна в каждом этапе: 360/390/768/1024/1440 px, телефон/планшет/поворот, safe area, клавиатура, нижняя навигация, прокрутка/длинный текст. Loading/empty/error/offline/retry. Визуальная проверка и скриншоты, исправить перекрытия/горизонтальное переполнение.
- Финансовые проверки только без реальных списаний: тестовый магазин ЮKassa, отдельные тестовые тарифы. Уведомления — выделенные QA аккаунты/устройства, не реальные клиенты. Автосписания/магазинный биллинг не добавлять.
- Вода: удаление и повторный импорт сначала только test, обязательны резервная выгрузка, предварительный список, анализ/обработка зависимостей. Не публиковать выдуманную цену.
- APK/PUSH на физическом устройстве проверять при наличии доступа. Если его нет, явно сообщить и дать точный чек-лист. Build/browser/no_device не доказывают работу на телефоне.
- Не объявлять спринт завершённым при заглушках, недоделанных интерфейсах или существенных невыполненных проверках. Этот файл обновлять после подзадач/этапов, промежуточно при длительной работе и перед завершением сессии; включать в коммиты соответствующих изменений. Отдельный push после записи не нужен.

## 3. Принятые решения

1. **Аккаунт + категория**, не отдельный новый auth role. Категории: quarry (карьер), accumulator (накопитель/warehouse), driver, carrier, equipment, water, firewood, septic. Используются supplier, driver, equipment_owner, water_septic_partner. Driver/carrier — альтернативный транспортный доступ, не требование двух оплат. Firewood — существующая supplier/catalog модель; при отсутствии материала подготовить корректную категорию/предложения без нового кабинета.
2. Trial **14 календарных дней от явного первого подключения/активации категории**, не от регистрации. Хранить начало/конец, проверять серверное время, повторная активация не продлевает. Постоянный реестр аккаунта/категории и нормализованного подтверждённого контакта защищает повторную регистрацию. Контакты в реестре — HMAC, не plaintext; ротация ключа требует отдельной миграции реестра.
3. Каждая машина проверяется по нормализованному госномеру. Один общий реестр номера для driver/carrier, смена телефона/аккаунта не обнуляет trial. Смешанный парк: у каждой машины собственная допустимость и исходный срок; добавление машины не продлевает account trial. Оплаченная категория покрывает парк. Споры о смене владельца/номера решает admin с журналом и явным доступом, реестр истории не стирается.
4. Существующие подтверждённые сроки перенести без перезапуска trial. Для объектов без владельца — grant на объект на подтверждённый остаток срока, затем серый маркер без телефона/нового заказа. Отсутствие подтверждённого срока — review, не автоматически новые 14 дней. Привязку хозяина проверяет admin.
5. После expiry профиль и карта/общедоступные функции сохраняются; новые заявки/платные возможности/чат закрываются. Ранее принятый или назначенный рейс можно завершить, включая статус `driver_assigned` после accept. Не ставить подписной gate на все driver endpoints.
6. Карьеры/накопители остаются видимыми после expiry, теряют контакты и новые заказы/доставки. Также ограничить equipment/water/firewood/septic по существующим возможностям. Модерационные/ручные скрытия/архив и внутренние CRM записи не раскрывать. Сохранить текущие зелёные/серые статусы, не вводить новую красно-жёлтую схему.
7. Автоподбор материала — **только quarry**; накопители и прочие допустимые точки выбираются вручную. Сохранить 120-секундное предложение, отказ/таймаут, действующие штрафы. Добавить повтор поиска при отсутствии кандидатов (по умолчанию 60 секунд, настраивается), исключая водителей без доступа. Проверки также в manual assign и direct API/accept.
8. ЮKassa обслуживает подписку: неизменяемый снимок тарифа/суммы/срока, идемпотентный запрос, durable jobs, успех только после server/provider проверки. Повтор webhook/late success/restart не создаёт второй grant. Pending не ошибка. Срок продления календарными месяцами от конца уже подтверждённого доступа/trial; не терять подтверждённые дни.
9. Технический возврат подписки связан с исходным payment и его grant, учитывает остаток/резерв/повторы/историю и внешние provider refunds. **Коммерческие правила не утверждены.** Изменение доступа — отдельное явное решение keep/revoke/shorten, только для grant данного платежа, остальные основания не затрагивать. Без решения — review, не произвольное лишение доступа.
10. Боевые цены пока **draft**, неизвестные не заменять нулём. Для driver/water/firewood/septic: 1/3/6/12 мес. = 1900/5400/10200/19200 ₽. Quarry/accumulator = 2900/8400/16200/30000 ₽. Equipment предложена первая сетка, подтверждения нет. Carrier цена не определена (`null`, не zero); отдельные QA test-only тарифы позволяют проверять механизм независимо.
11. Вода — только продавцы: удалить существующие бесплатные точки с backup/dependencies, убрать free/paid переключатели и «Бесплатная вода», запретить free через API/БД. Сохранить цену, объём/единицу, контакт/местоположение. Reparse продавцов, неизвестные цены — staging/moderation, не готовая платная точка. Trial бесплатен для приложения, не для воды.
12. Общий чат один для всех категорий: trial/paid/сохранённый category access, text + polling/cursor (5 сек.). Обычного B2C тарифа чата нет. Admin имеет служебный доступ; модератор должен иметь подписной доступ. Expiry закрывает чтение/отправку и очищает отображение переписки. Оплата не снимает санкции.
13. Модерация: delete, warning, mute/unmute, ban/unban, remove/restore, назначение/снятие модераторов (admin), правила, pin/unpin объявлений, журнал кто/когда/кого/почему. Модераторы не повышают себя и не меняют других модераторов/admin.
14. Контроль пути: отдельные visitor/session/attempt/order/payment. Анонимная история до входа; контакт после отправки формы, связь с аккаунтом только после серверного подтверждения входа. Не объединять устройства предположительно. Повторные попытки/заказы сохраняются отдельно; последний этап пользователя не равен статусу заказа/попытки.
15. События: открытие, начало/отправка авторизации, ошибки кода/проверки/сессии; начало/заполнение/отправка/создание заказа, его принятие/назначение/доставка/получение/отзыв; подписная оплата pending/success/error/cancel/продление/expiry. Успех auth/order/payment подтверждается backend/provider, клиент не может его заявить.
16. Offline queue и уникальные event IDs; дедупликация событий и уведомлений, повтор отправки после восстановления сети. Нет гарантии полной видимости, если приложение не загрузилось или событие не дошло. Никогда не писать OTP/password/token/card details/raw provider bodies в аналитику/логи.
17. Контакт в списке маскируется, раскрытие admin отдельно с audit. События 90 дней/контакты попыток 30 дней; настройки изменяемы. Idle: auth 10 минут, order/subscription 30 минут; незавершённость отдельно от подтверждённой ошибки, закрытие экрана не доказательство сбоя. Late success снимает текущую незавершённость/проблему, сохраняет историю.
18. Owner alerts — существующие in-app/PUSH с настроенным получателем, типами событий, группировкой ошибок ввода (5 минут). Abandoned alerts отдельный opt-in. Если recipient не настроен, внешние сообщения не отправлять. Ошибки доставки сохранять/повторять через outbox без дублей; на тесте только QA.
19. Admin: посетители (в т.ч. anonymous), последний этап/время/проблема/контакт, хронология, связанные попытки/заказы/платежи/уведомления, фильтры период/этап/проблема/auth/city (неизвестный город остаётся), сводки переходов/ошибок/незавершённостей, настройки сроков/alerts.
20. Получение/отзыв: клиент подтверждает после delivered/completed, один отзыв 1–5 с необязательным текстом; дополняет существующую карточку без изменения delivery enums и рейтинговой диспетчеризации. Доступ client/admin, без выдуманного публичного рейтинга.

## 4. Актуальный план и чек-лист этапов 26.1–26.7

Статусы: **не начато / в работе / реализовано без проверки / проверено / заблокировано**. Проверка isolated не означает публикацию или проверку на телефоне. Общий спринт **в работе**, итоговой приёмки нет.

### 26.1 — основание, схема и безопасный переход — проверено на test

- [проверено] Node AGENTS/README/workflows, source/remote/runtime baseline, сохранность чужих dirty docs. Canonical handover — этот файл.
- [проверено] Additive frozen migration `s26_subscription_platform`, parent `release_317_merge_heads`: 18 таблиц подписок/доступа/чата/аналитики/review; vehicle plate_key, order settlement_mode/next_dispatch_at. Downgrade/re-upgrade на fresh isolated DB и приватном клоне текущего test backup.
- [проверено] Хеши исторических строк clone orders/items/users/vehicles/water/media/payments/events/refunds совпали после round trip: 127 заказов, 9 платежей, 2 возврата. [Отчёт](reports/sprint26/migration-clone.json), скрипт `scripts/sprint26_migration_smoke.py` разрешён только disposable DB `s26_migration_test`.
- [проверено] Explicit transition preview/apply сохраняет даты, account/resource grants, повтор не дублирует. На clone: 34 ресурса, 17 grants, 17 без подтверждённого срока на review, 68 невалидных исторических тестовых госномеров. Не выдавать им придуманный trial.
- [проверено] CI доставил c07 на runtime test, применена s26_subscription_platform; setup --enable перенёс 17 подтверждённых grants и включил функции. Runtime rollback миграций не выполнять.

### 26.2 — единые подписки, trial, тарифы, автопарк и админка — в работе

- [проверено] Аккаунт + 8 категорий, 14 дней explicit activation, persistent HMAC identity/plate registry, точные границы, календарные продления, concurrent activation, mixed fleet/paid override, recreated vehicle. Driver↔carrier используют исходный общий deadline; новая машина и смена категории его не продлевают, истёкший период не перезапускается. Последний access набор: **23 passed**.
- [проверено] Draft commercial планы 1/3/6/12 месяцев, carrier amount=null; отдельные test-only plans, неизвестные цены не 0. API role checks/manual grants/vehicle dispute audit/account lookup проверены адресно.
- [проверено] SubscriptionsScreen для всех 4 профессиональных ролей, supplier activation, история; responsive 360/390/768/1024/1440 + 844 landscape на isolated backend. Неопределённый request повторяется с прежним key, после success допустима новая покупка того же тарифа (browser test прошёл).
- [проверено] AdminSubscriptionsScreen содержит plans/payments/refunds/source-access decisions/grants/plate history/settings/transition/audit. Основные responsive экраны/role checks проверены; live административный refund с test provider ещё предстоит.
- [реализовано без проверки] DriverSubscriptionNotice и public catalog maps в профессиональном профиле: явное предложение trial/подписки, сохранение принятого рейса и карты без подписки. TypeScript/build прошли; финальный browser/visual этих последних элементов нужен.

### 26.3 — подписная оплата/возвраты и прямые расчёты — в работе

- [проверено] Immutable payment snapshot, server/provider validation, durable worker, stable idempotence, webhook replay, late binding, transient recovery, restart/new DB session, 23h no-repeat POST window; баланс/резерв refund, external refund import/review, явное keep/revoke/shorten только source grant. Другие grants не меняются. Изолированные billing/recovery/observability tests прошли.
- [проверено] Новый order direct settlement, запрет нового order payment в прежних endpoints (старые APK), сохранение исторических платежей/refunds и существующих regression tests. В клиентской карточке виден direct notice, кнопки онлайн-оплаты нового заказа нет. Terms дополнен фактическим правилом прямых расчётов; коммерческая refund-политика подписок не придумана.
- [проверено] Test runtime settings проверены без вывода секретов: test shop/test key, receipts включены. `.env` не менялись.
- [проверено] Реальная покупка в тестовом магазине ЮKassa через web: pending пережил force-recreate backend_test с прежними provider/idempotence IDs, grants=0; после тестовой оплаты backend подтвердил succeeded и создал ровно 1 source grant. Только QA, без реальных денег. Частичный refund/UI/source-access decision и renewal/decline ещё в работе.

### 26.4 — ограничения точек/контактов/новых заказов/диспетчеризации — в работе

- [проверено] Разделены map visibility и orderability: approved expired точки видимы серыми, телефон/description/raw parsed_data скрыты, новые pricing/checkout/manual/dispatch запрещены, manual hidden/archive/internal CRM не раскрываются. Автоподбор только quarry; accumulator выбирается вручную. [Resource report](reports/sprint26/resource-gates.md).
- [проверено] Water/septic public contacts скрыты, own/admin остаются доступны; raw fields тоже. Wholesale/equipment application gates подключены. Equipment contact surfaces требуют последнего live прохода.
- [проверено] Central SQL + admission gates: manual/direct accept без подписки запрещены, decline/timeout передают следующему доступному водителю, **120 секунд сохранены**; no_driver_found retry 60 секунд без повторных уведомлений. Новый `test_sprint26_dispatch.py`, последняя combined dispatch/resource/observability группа: **13 passed**.
- [проверено] Назначенный рейс проходит heading_to_pickup → loading → delivered → completed после expiry. Subscription gate не установлен на завершение.
- [не начато] Финальные live QA checkout/gray map/manual selection/manual assign/current-trip/contact leak tests на опубликованном test web/API.

### 26.5 — платная вода, резервирование, очистка и повторный импорт — в работе

- [проверено] API + conditional raw PostgreSQL trigger запрещают free/invalid paid, unknown разрешён только inactive internal staging. **6 dedicated water/admin/cleanup tests passed**, включая stale preview, private verified backup до удаления, отказ при неизвестных FK.
- [проверено] UI partner/admin больше не создаёт free; цена/единица/телефон/место сохранены. Paid-water формы проверены на всех целевых ширинах; найденный старый subtitle исправлен. Карта фильтрует только paid.
- [проверено] Runtime test: до удаления full pg_dump и отдельный JSON.gz snapshot, preview SHA совпал. Удалено **6 free water_points + 5 media metadata**, audit=0, FK отсутствуют; S3 objects сохранены для восстановления. [Preview](reports/sprint26/water-preview.json), [cleanup](reports/sprint26/water-cleanup.json), [backup metadata](reports/sprint26/test-backup.json). Private backup вне git, каталоги 0700/файлы 0600.
- [проверено] Коммерческий reparse 2GIS в Тюмени: **52 создано**, повтор **0 создано / 52 обновлено**. Бесплатные источники исключены по рубрикам; цены не придуманы: 52 unknown inactive/pending_moderation/auto_added, не опубликованы. [Import](reports/sprint26/water-import.json), [repeat](reports/sprint26/water-import-repeat.json). Существующие 4 paid точки не имеют invalid public price/contact fields; free осталось 0.
- [в работе] После включения flags проверить public map/API, DB/API отказ новых free на runtime и недоступность staging на клиенте. Реальные цены новых поставщиков вводятся после проверки оператором.

### 26.6 — общий чат, модерация, окончание доступа — в работе

- [проверено] Один text/poll chat (5 секунд), cursor/history/changes не теряют >50 сообщений, idempotent send/rate limit. Access каждой операции, admin service bypass, moderator только с подпиской, sanctions не снимаются оплатой.
- [проверено] Delete/tombstones, warn, mute/unmute, ban/unban, remove/restore, moderator roles, rules, pins, audit; backend tests и browser send/offline recovery/pin/delete прошли.
- [проверено] Admin moderation form/audit и expiry **во время открытого чата**: сообщения очищаются, read/write закрыты, CTA подписки виден, после восстановления доступа чат работает. Responsive + short keyboard viewport screenshots сохранены; warning направлялся только QA.
- [не начато] Короткий live smoke чата и QA in-app notification после runtime deploy. Physical PUSH не подтверждён (нет устройства).

### 26.7 — путь посетителя, проблемы, уведомления, получение и отзыв — в работе

- [проверено] Anonymous visitor/session/attempt, backend verified identity link, auth/order/subscription server success, multi-order child attempts + parent cart, order-status catch-up при гонке. Client success/секретные поля не принимаются, контакты encrypted/masked/admin audited reveal, polling не продлевает idle.
- [проверено] Bounded offline queue/dedup/retry без body/password/OTP/token/card; provider pending не failed, transient technical incident/recovery отдельны, late success снимает проблему, retention и configured owner outbox/in-app dedup. Фактически установленный error handler передаёт контролируемый business code в journey; старый message/support error reference сохраняются.
- [проверено] Admin list/filters/summary/transitions/chronology/orders/payments/incidents/deliveries/settings, URL deep links. Isolated anonymous failed login без account + offline reconnect + audited contact reveal прошли в браузере на целевых ширинах. Service worker navigation tests: 4 passed (synthetic, не real PUSH).
- [проверено] Existing order card: клиент received + один отзыв 1–5/comment, ownership/idempotence, direct notice. Backend и responsive Playwright прошли.
- [не начато] Финальные live anonymous/owner in-app/repeated order/payment failure/notification URL сценарии после deploy; physical APK/PUSH ограничения вынести в отчёт и ручную приёмку.

## 5. Исходники, коммиты, рабочее дерево

Рабочий каталог **`/opt/darmavoz_test`**, branch **develop**, HEAD и origin/develop **`28a7b5ae`** (analytics follow-up, pushed). Runtime и опубликованный первоначальный APK пока **c07d678e**, новая test CI запущена.

- `6a7b95f1` — subscription platform/chat/journey foundation + frozen migration + UI/tests.
- `c07d678e` — исправления shared transport trial/access/diagnostics, notices/maps, проверки, безопасная вода и первый test release.
- `28a7b5ae` — city context, reconciliation retry/renewal, test release setup/probes и актуальная передача, pushed только develop.

**Собственные незакоммиченные изменения сейчас:** этот handover после push 28a; sandbox screenshots/reports могут добавляться во время live теста. Код и test setup/probes/helper уже включены в 28a. Сверять git status, не путать runtime c07 и source 28a.

**Чужие исходные tracked dirty:** `docs/README.md`, `docs/blocks/logist-drivers.md`, `docs/blocks/refunds.md`. В README наши две S26 ссылки закоммичены частичным index, чужой diff сохранён. Многочисленные исходные untracked audit/screenshots/scripts не трогать/не stage целиком (особенно `scripts/debug_b6a576_refund.py`). [Baseline](reports/sprint26/baseline.json).

Основные source/API/модели: `app/models/subscriptions.py`, `alembic/versions/s26_subscription_platform.py`, `app/services/{subscriptions,subscription_billing,subscription_transition,sprint26_worker,journey,journey_middleware}.py`, `app/api/{subscriptions,general_chat,journeys}.py`; gates в существующих pricing/pickup/driver/dispatch/equipment/water/wholesale/payment endpoints. Frontend: SubscriptionsScreen, AdminSubscriptionsScreen, GeneralChatScreen, AdminJourneysScreen, OrderReviewPanel, DriverSubscriptionNotice, PublicCatalogMap, journey.ts + интеграция существующих экранов. Адресные tests `tests/test_sprint26_*.py`, opt-in browser `frontend/tests/e2e/sprint26-isolated.spec.ts`.

## 6. Реальный test deploy и артефакты

Проверено **30.10.2026 09:26 UTC**, подробнее [test-deployment.json](reports/sprint26/test-deployment.json):

| Компонент | Факт |
|---|---|
| Source/origin develop | c07d678e, pushed |
| Runtime `/opt/darmavoz_test_deploy` | c07d678e2fcfbd997a1dc71283db9c9c53ccb7c4 |
| backend_test | image sha256:5efc0f0d4df0a32425ffa2bdae8f71936bcf2c81f4be9e27ec82ed8e1c3f62f6, start 30.10 09:18:40 UTC |
| Runtime schema/features | s26_subscription_platform, все 5 S26 feature flags включены; owner alerts — только отдельный QA admin |
| Test data | очистка free + 52 inactive water sellers уже применены, backup сохранён |
| Test backend CI | job sprint22-checks успешен |
| Test frontend/deploy CI | success: frontend checks/Playwright + фактический backend/web deploy |
| Test APK | новый c07d678e опубликован, HTTP download SHA256 проверен |

Actions: [Test deploy 41030916930](https://github.com/daoosai/darmavoz/actions/runs/41030916930), [Test Android 41030916870 — success](https://github.com/daoosai/darmavoz/actions/runs/41030916870). Для c07 запущены только эти два тестовых workflow. Production не запускался.

Web: https://test.darmavoz.ru/app — c07 опубликован, `/build-info.json` подтверждает SHA. Health API online 3.3.3. APK: [immutable c07 artifact](https://test.darmavoz.ru/static/darmavoz-test-c07d678e2fcfbd997a1dc71283db9c9c53ccb7c4.apk), version 3.3.3/build391, **19 869 235 bytes**, SHA256 **5e029fb0699fc6c0c4e8f3a4dda5902b2cfc7e3bb143fcc4b0edd77e8ec5fa7c**. [Manifest/report](reports/sprint26/android-artifact.json); build manifest также `/static/darmavoz-test-build.json`. Это доказательство сборки/доставки, **не работы на физическом телефоне**. На ноде adb/device connection нет.

QA: `s26_qa_postgres`, `s26_qa_redis`, `s26_qa_backend` на 127.0.0.1:18026; source Vite18260/18261, stable preview18262. Это disposable isolated, **не public test runtime**. Pytest создаёт собственную darmavoz_test_db_<random>. Private backup clone `s26_migration_test`, без app workers. Runner `/tmp/s26-qa-run.py` — удобство ноды, проверить safe overrides; не печатать env. `/tmp/s26-test-runtime-run.py` отдельно guarded container на настоящей **test** DB с backup bind mount; SMS/FCM для CLI отключены. Не путать эти два runner.

## 7. Проверки, отчёты, ограничения

- Backend CI-equivalent до последних targeted изменений: **264 passed / 14 warnings / 332.68s**; текущий GitHub backend job после изменений **успешен**, получить финальный count из job log в отчёт.
- Последние focused: access23; water/admin/cleanup6; dispatch/resource/observability13 — pass. Fresh migration + private backup clone round trip pass, [clone report](reports/sprint26/migration-clone.json).
- TypeScript и frontend build прошли. Test workflow YAML/bash syntax проверен, versions/.env не менялись. UI screenshot filenames в [screenshots/](reports/sprint26/screenshots/); просмотрены admin mobile/desktop, subscription roles, chat/moderation/expiry, paid-water form, client review и anonymous chronology. Новые notice/public maps ещё проверить.
- Browser regression первоначально 168 pass/4 fail; paid-only fixture и conditional client setup исправлены; **6/6 targeted retry pass** на stable build. Текущий CI выполняет весь набор заново; до его успеха не объявлять полный regression green.
- Isolated новые screens: первые5 pass, затем отдельные moderation/expiry + paid water **2 pass**, renewal **1 pass**. Последний единый 8-case запуск после всех изменений ещё нужен, затем live smoke.
- Известные **baseline**, не скрывать: `test_sprint18_relevance::test_public_point_disappears_after_expiry_and_returns_after_extension` воспроизведён на 907182ae; старый test_dispatch_flow дал 7 fail/8 pass (city/coordinates/Redis-loop fixtures), первый failure также воспроизведён на baseline. Текущие бизнес-правила handoff покрыты новым S26 тестом. Весь исторический pytest suite не объявлять зелёным.
- Логи .log локально в reports/sprint26 (gitignore), безопасные результаты дублировать в md/json. [Исторические checkpoint](reports/sprint26/checkpoint-history.md) сохранены отдельно и **не являются текущим статусом**.

Коммерческие вопросы до production: утверждение тарифов/equipment/carrier, полных/частичных refund правил и source-access решения, receipt/VAT/offer/privacy, спорных legacy owners/номеров и сроков хранения антиабузного реестра. Технический тестовый выпуск не означает утверждение коммерческих условий. Автосписания/store billing не входят.

Неподтверждённое технически: live sandbox purchase/refund/restart/webhook, runtime feature transition и live E2E всех новых flows; финальные new notice/map layouts; physical APK/PUSH (доступа нет). Не объявлять спринт завершённым пока существенные пункты не закрыты; отсутствие устройства указать отдельно с точной ручной проверкой.

## 8. Продолжить отсюда

**Следующая конкретная задача:** дождаться test CI после визуального follow-up (карта/outline кнопка), выполнить `scripts/sprint26_live_api_smoke.py resources|sandbox`, затем QA-only checkout→assignment→completion. Покупка, partial refund/keep, restart pending, live anonymous linkage/city/chat и owner in-app уже проверены; не повторять их без причины. Source HEAD3adda8ba + visual follow-up, runtime3adda8ba deploy завершается. CLI запуск во время Docker image prune CI дал No such image — повторить после завершения deploy, данные не менялись. Не запускать параллельные миграции/деплой.

После подтверждённой migration:

1. Проверить и выполнить `scripts/sprint26_test_release_setup.py --enable` через guarded test-runtime runner (bind backup). Скрипт требует DB darmavoz_test + test shop + exact S26 revision. Он переносит подтверждённые периоды, создаёт отдельные QA actors/resources/test-only tariffs, owner alerts только QA admin, включает S26 flags. Токены сохраняет **приватно вне git**, в отчёты их не выводить. Script выполнен успешно; [test-setup.json](reports/sprint26/test-setup.json). Повтор идемпотентен. Исправлять ошибки только в test, без изменения production/.env.
2. Live web/API E2E: gray point/contact redaction → explicit trial → material/manual storage checkout с прямыми расчётами → запрет старого order-payment endpoint → subscribed driver manual/offer/accepted trip completion после expiry; water/equipment/septic/firewood capabilities, free rejection/staging hidden. Использовать только QA order/client/driver.
3. Sandbox subscriptions: purchase/renewal/decline, pending через фактический restart backend_test, provider-authoritative webhook/replay, partial refund и explicit source-grant decision, прочие grants неизменны. Только тестовый ключ/test plans; не использовать настоящие карты/списания. Официальные test данные: https://yookassa.ru/developers/payment-acceptance/testing-and-going-live/testing . Confirmation URLs/токены в отчёты не писать.
4. Live чат/moderation/expiry/owner in-app/anonymous offline and verified linkage/repeated orders. Повтор isolated 8-case + notice/public-map responsive360/390/768/1024/1440/landscape, screenshots/visual/scroll/short keyboard. На телефоне PUSH/keyboard/safearea не объявлять проверенными без устройства.
5. Сверить baseline production image/start/restart и `.env` hashes; проверить immutable APK и health снаружи. Зафиксировать applied migration/settings/actual runtime SHA отдельно от source и docs commits.
6. Обновить этот документ и block report, включить свои remaining ops/report/workflow guard изменения в commit. Перед каждым push проверить workflow scope; для чисто docs/ops без изменений app допустим отдельный `[skip ci]` checkpoint, явно сохранив code release SHA c07, а не выдавая его за новый APK. Чужие docs не stage.
7. Итоговый отчёт: этапы/остатки, web/APK URLs/hash, commits/migrations/flags, auto/E2E/visual/screenshots, неподтверждённые коммерческие/physical сценарии, короткая ручная приёмка, production unchanged. Не останавливаться после одного этапа ради нового разрешения.


### Последний незакоммиченный follow-up после публикации c07

На live/review обнаружено: Session.city_id не заполнялся, а несколько attempts одного pending payment могли оставлять старую попытку pending после успеха. Исправлены `journey.py`, `journey_middleware.py`, `api/journeys.py`, `frontend/journey.ts`: валидированный analytics-only X-Journey-City-Id (не вмешивается в business city scope), selected city change без нового несовместимого event type; source order city имеет приоритет, несуществующий city не угадывается. Все связанные payment attempts завершаются, старый canonical event UUID сохраняется, дополнительные попытки имеют stable IDs; renewal фиксируется также при позднем связывании по audit.

Тесты `observability + chat/journey + billing recovery`: **19 passed, 4 warnings, 22.51s**. Первый combined проход выявил Redis singleton между pytest loops; новая city fixture изолирует только rate store, runtime код Redis не менялся. TypeScript/build прошли. Требуется commit/push follow-up и повторный test deploy/APK, затем final live city/retry checks. Приватные QA credentials никогда не печатать; helper/script reports их не содержат.

Sandbox pending payment сохранён после фактического force-recreate backend_test: прежние payment/provider/idempotence digest, grants=0, attempts 4 → 6. Пробуждён только QA job (next_attempt_at), результат платежа не менялся. Browser city smoke с новой JS instrumentation: **1 passed, 13.6s**. Следующее — sandbox pay/refund и follow-up CI.

Последний push: `28a7b5ae` (develop); тестовые workflows для follow-up выполняются. Pending sandbox payment пережил restart с attempts 4→6, исходный provider/idempotence и grants=0 сохранены. Следующий шаг — test checkout pay/refund; helper inspect открыт.

### Контрольная точка текущего продолжения

Follow-up `28a7b5ae` pushed: backend CI и test APK успешны; web deploy ещё выполняется. Реальный sandbox payment после restart подтверждён succeeded, source_grants=1. Ошибка вспомогательного browser script (нажимал ссылку ЮMoney в footer вместо способа оплаты) исправлена, код продукта не менялся. Следующее: частичный sandbox refund через AdminSubscriptionsScreen и проверка source-only access; затем финальный live smoke и responsive notice/maps. Private QA данные/confirmation URLs в git не сохранять.


### Live проверка частичного возврата: найдено техническое ограничение провайдера

Из 1 ₽ нельзя вернуть 0,40 ₽: ЮKassa разрешает частичный refund от 1 ₽ и остаток 0 либо >=1 ₽ (официальная документация: https://yookassa.ru/developers/payment-acceptance/after-the-payment/refunds). Первый QA запрос сохранён failed/provider_validation, деньги и grants не менялись. Добавлены server-side `REFUND_PROVIDER_LIMITS` и понятная подсказка формы; unit tests границ в работе. Это техническое ограничение API, не утверждение коммерческой политики. Для live partial refund нужен отдельный test-only тариф >=2 ₽; прежние QA тарифы/история не редактируются. Последний единый isolated browser прогон: **8 passed (1.5m)**, включая chat expiry/offline/anonymous/review/все роли.

Live diagnostic: HTTP400 invalid_request, parameter amount.value; provider description confirms remainder constraint. Exact sanitized report saved next. Runtime now28a7b5ae (public build-info), both test workflows success. Partial-limit backend/UI fix and six regression cases are uncommitted; do not lose them.

Sandbox: новый QA test-only тариф 10 ₽/3мес, покупка succeeded, частичный refund **3 ₽ succeeded**, остаток7 ₽. Техническое решение keep ещё не завершено (доступ не изменён, требуется review). Helper исправлен для точного поиска select. Новый server-side provider-limit набор: **34 passed (19.50s)**; lint/TypeScript/build pass.

Live partial refund и отдельный keep выполнены через опубликованный AdminSubscriptionsScreen: 3.00 ₽ succeeded, доступный остаток7.00 ₽, access_review_required=false. Report `reports/sprint26/sandbox-refund.json`. CI28a counts: 272 backend /172 browser passed. Подготовлен следующий commit технических лимитов partial refund (без новой миграции/версии).


### Визуальный follow-up после live screenshot review

Live notice/maps/chat/verified anonymous history прошли геометрические проверки всех ширин; скриншоты просмотрены вручную. Найдены и исправлены в source: конфликт text-white/text-sky на белой кнопке «Карта материалов» и перекрытие toolbar вложенной карты zoom controls SDK. Кнопке назначен обычный существующий outline стиль без конфликтующих классов. Только для нового embedded экрана maps SDK controls перенесены bottomLeft (официальный MapGL option), enableTrackResize включён; отдельные прежние карты сохраняют расположение controls. Требуются TS/build и визуальная перепроверка после следующего test deploy. Не путать скрытую map clipping геометрию с фактическим горизонтальным переполнением.


### Закрытые live UI/owner проверки

`frontend/tests/manual/sprint26-live-ui.cjs profiles chat journey`: pass, реальные API/SDK тестового сайта, 36 контрольных снимков. Anonymous→verified admin linkage, masked contact/audited reveal, selected-city filter, offline queue и дедупликация проверены. Chat send/pin/delete/offline draft и warn направлены только QA.

Owner test дождался реальных настроенных **5 минут** группировки: **3 неуспешных QA входа → 1 in-app уведомление только QA admin**. Ссылка уведомления открыла нужную хронологию; [report](reports/sprint26/live-ui-owner.json). `no_device` не доказательство PUSH; физического телефона нет.

Визуальный follow-up: новый browser case **1 passed (13.6s)** проверил контраст outline кнопки и три карты во всех6 размерах; скриншот driver-notice-fixed-360.png просмотрен. TS/build pass. Следующий test commit публикует эти исправления; после deploy повторить real SDK screenshots.


### Live resource follow-up (незакоммиченный)

Сработала проверка скрытых контактов: equipment list вернул500, потому что public payload скрывает description=None, но response schema объявляла обязательную str. Исправлены только output schema и nullable frontend type; input/owner формы сохраняют требуемое описание. Добавлен тест list/detail без подписки и восстановление после grant. Проверки в работе. Live resource script успел активировать только QA water/septic trials, остальное не применял. Sandbox ledger/repeated webhook check прошёл:2 succeeded payments,1 partial refund, повторные webhook/requests не изменили3 grants, обе попытки succeeded, renewal audit/event есть.


### Финальная классификация неуспешных оплат (в работе)

Provider canceled не всегда означает отмену клиентом: например insufficient_funds — отказ банка. Добавлено сохранение только allowlisted provider reason, terminal observation для live и late binding; bank decline становится failed attempt/owner provider_rejected, сознательная отмена — canceled/user_cancelled. В UI добавлены понятные причины без raw provider body. Покупка/история самого провайдера остаётся canceled, доступ не выдаётся. Новые backend tests и TS/build в работе. Equipment output-description nullable:5 resource tests passed. Live checkout QA helper исправлен: UUID Idempotency-Key и explicit accumulator trial; предыдущие отказы400/404 не создали заказов/уведомлений реальным пользователям.


### Проверки входных QA данных и старого каталога

QA checkout корректно требовал уточнения из-за отсутствия телефона отдельного QA Client. В setup/helper добавлен заведомо тестовый контакт; реальные клиенты не менялись. Public map payload выбирал offers даже для неактивного Material и мог снова показывать старый «Бесплатная вода», хотя материал уже архивирован. Public payload теперь исключает inactive Material; operator owner-detail сохраняет историю. Добавлен тест public global/detail. Автоподбор quarry-only не менялся.


### Реальный test DB/Redis order E2E прошёл

`scripts/sprint26_live_orders.py`: два отдельных QA заказа с ручным накопителем,10м³×1₽ +0₽ delivery; одинаковый Idempotency-Key возвращает тот же заказ, прежний order-payment endpoint409. Manual assign без transport access409, driver/carrier trial с одинаковым deadline. Первый назначенный рейс прошёл все6статусов до completed после expiry обеих transport категорий, водитель available. Trial даты восстановлены, платёж/платежный реестр не изменены. Received/review ownership/idempotence и две отдельные journey chains проверены.

Транспорт проверки: реальные FastAPI handlers ASGI + настоящая test DB/Redis, notification enqueue ограничен QA recipients в процессе CLI; external dispatcher исключён bounded per-order Redis locks до завершения. **108 non-QA deliveries подавлены**,68jobs толькоQA. Это не утверждение о кликах оформления в публичном web и не доказательство физическогоPUSH. Public UI/API показ/расчёт и чтение проверяются отдельно. [Отчёт](reports/sprint26/live-orders.json); не повторять helper без необходимости (driver trial теперь активен).

Последний targeted acceptance набор: **30 passed,4warnings,30.67s** после equipment/decline/archived-offer fixes; lint/TS/build pass. Следующий commit содержит эти исправления; runtime перед ним0fd8dd19. Остаётся sandbox bank-decline browser, live resource smoke после нового deploy и финальная сверка APK/visual/production baseline.

Следующий кодовый commit: public resource/decline fixes после30passed; основной test runtime0fd8dd19, обновлённый code пока не опубликован. Ветка develop, чужие3dirtydocs сохранены. Нужны live resources после CI, provider decline/owner notification и финальная visual/APK/baseline сверка. Helpers live-api/resources/catalog и sandbox/card могут быть незакоммичены; не терять.

UI follow-up: временный provider_unavailable у pending показывается как ожидание уточнения статуса, без ложного сообщения об отказе банка. Добавлен browser regression pending→bank-decline; тест в работе. Bank decline source a378dc58 pushed, test CI выполняется.


### Опубликованный клиентский UI после полного QA рейса

`frontend/tests/manual/sprint26-live-ui.cjs client`: публичный test web открыл второй completed QA заказ, подтвердил получение, отправил5⭐отзыв, проверил отсутствие онлайн-оплаты заказа и адаптивность6размеров +390×420keyboard viewport. [Report](reports/sprint26/live-ui-client.json). Физический телефон не проверялся.

Browser regression pending/transient → bank-decline: **1 passed (14.1s)**, lintpass. Только подтверждённый provider canceled с bank-rejection причиной помечается failed; пока providerAPIpending, попытка остаётся pending, деньги/сроки не меняются. SDK может разрешать повтор способа оплаты после неуспешной карточной попытки; это не повод объявлять весь parent payment failed.
