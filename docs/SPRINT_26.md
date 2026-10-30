# Спринт 26 — единый документ передачи и состояния работы

**Следующей сессии:** сначала прочитать этот файл, `/opt/darmavoz_test/AGENTS.md`, README и применимые `.github/workflows/` **на ноде**. Проверить `git status`, актуальные ветки и фактически запущенный тестовый контур. Затем продолжить с раздела **«Продолжить отсюда»**. Чужие и неизвестные изменения не перезаписывать, не сбрасывать и не включать в свои коммиты. История чата для продолжения не требуется.

Обновлено: 2026-10-30 UTC. Общий статус: **реализация 26.1–26.7 опубликована на тесте; полная приёмка остаётся открытой по перечисленным ниже ограничениям**. Этот документ — основной источник передачи работы. Старые `sprint26-plan.md` и `sprint26-progress.md` сохранены как контекст, но их промежуточные статусы могут отставать.

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

## 4. План 26.1–26.7 и фактический чек-лист

Статусы: **не начато / в работе / реализовано без проверки / проверено / заблокировано**. Изолированные тесты, actual test API/DB, опубликованный web и физическое устройство — разные виды проверки. Техническая готовность не утверждает коммерческие условия.

### 26.1 — основание, миграция, безопасный переход — проверено

- [проверено] Прочитаны инструкции ноды/README/workflows, сохранены baseline и чужие изменения. Вся работа только develop/test.
- [проверено] Frozen additive migration `s26_subscription_platform`, parent `release_317_merge_heads`: 18 новых таблиц и поля vehicle/order. Основные файлы: `app/models/subscriptions.py`, `alembic/versions/s26_subscription_platform.py`, `subscription_transition.py`.
- [проверено] Fresh isolated upgrade/downgrade/re-upgrade и round trip на приватном клоне test backup. Исторические 127 orders, 9 payments, 2 refunds и связанные таблицы не изменились по digest. [Clone report](reports/sprint26/migration-clone.json); `scripts/sprint26_migration_smoke.py` допускает только disposable DB.
- [проверено] Перенос сохраняет подтверждённые даты и object grants без владельца, не начинает новый trial. На test перенесено 17 grants; 17 неподтверждённых ресурсов оставлены для review, 68 невалидных исторических номеров не получили придуманный trial. Повтор переноса не создаёт дублей.
- [проверено] Миграция применена на test runtime; пять S26 flags включены. Production миграции не запускались.

### 26.2 — подписки, trial, автопарк, тарифы и админка — проверено API/web

- [проверено] Account + 8 categories, явные 14 дней, UTC boundaries, HMAC контакта, реестр нормализованного госномера; concurrency, повторная регистрация, смешанный парк, оплаченный доступ. Driver↔carrier и добавление машины не продлевают исходный срок. Проверено 23 focused access tests и последующей CI regression.
- [проверено] Черновики коммерческих тарифов, `null` для carrier, отдельные test-only планы. Admin RBAC, ручные grants с причиной, спорный номер/история, поиск аккаунта, настройки, переход и аудит. Новых auth ролей нет.
- [проверено] SubscriptionsScreen/AdminSubscriptionsScreen: активация, история, повтор неопределённого запроса и продление; планы, платежи, технические возвраты и отдельное решение по доступу исходного платежа. Все вкладки админки проверены браузером; дополнительные access/transition/audit снимки на 6 размерах.
- [проверено] DriverSubscriptionNotice и общая карта при отсутствии доступа. Исправлены контраст кнопки, перекрытие toolbar контролом SDK, высота embedded карты в landscape, слои SDK/locator поверх карточки, обрезание water/septic sheets. Карточки используют внутреннюю прокрутку и доступное закрытие; текущий стиль сохранён.
- [проверено] После layout fix: 10 isolated browser tests (1.8m), ещё один расширенный admin case (32.0s). Опубликованный web: 42 снимка notice/трёх карт/трёх карточек, bounds/scroll/hit-target checks, отсутствие legacy free-water фильтра. [Published profiles](reports/sprint26/live-ui-profiles.json), [visual index](reports/sprint26/screenshots/README.md).

### 26.3 — подписные платежи/возвраты и совместимость — проверено API/web

- [проверено] `subscription_billing.py`/`sprint26_worker.py`: immutable snapshot, idempotence, durable jobs, authenticated provider GET, webhook/replay, late binding, restart/recovery, 23h guard, чеки и история. Новый order payment запрещён, включая прежний APK endpoint; исторические платежи/возвраты обслуживаются.
- [проверено] Реальный **тестовый** магазин ЮKassa без настоящих списаний: pending пережил force-recreate backend_test с прежними provider/idempotence IDs и без преждевременного grant. Подтверждение создало ровно один grant.
- [проверено] 3 sandbox покупки; partial 3 ₽ из 10 ₽, остаток 7 ₽ и явное UI keep; full 1 ₽ из 1 ₽ и явное UI revoke только последнего source grant. Предыдущий и независимый доступ сохранён. [Partial](reports/sprint26/sandbox-refund.json), [full](reports/sprint26/sandbox-full-refund.json).
- [проверено] Provider GET и повторные webhook/payment requests: 3 successful payments, 2 refunds, 1 revoked source; 3 succeeded attempts, 2 renewal audits/events. Replay не создаёт операции/grants и не меняет существующие основания доступа. [Ledger](reports/sprint26/live-sandbox-ledger.json).
- [проверено] HTTP400 на попытку вернуть 0,40 ₽ из 1 ₽ диагностирован. Server/UI проверяют технические границы до постановки job: refund >=1 ₽, остаток 0 или >=1 ₽. 34 billing checks и boundary cases. Pending recovery, bank rejection и user cancellation различаются в UI/аналитике/owner filters; коммерческая политика не придумана.
- [проверено] Реальная тестовая карточная попытка «Не хватает денег» оставила parent pending для retry; затем тот же payment успешно оплачен test wallet. [Card observation](reports/sprint26/sandbox-card-attempt.json).
- [реализовано без проверки live] Окончательный bank canceled не получен: hosted checkout оставил pending. Terminal rejection/user cancel/late binding/replay/owner classification проверены изолированно. Не выдавать это за live webhook окончательного отказа.

### 26.4 — точки/контакты, заказы и dispatch — проверено API и затронутые web экраны

- [проверено] Approved expired точки остаются серыми; phone/description/parsed_data скрыты. Manual hidden/archive/internal CRM не раскрываются. Серверные gates pricing/checkout/wholesale/equipment/water/septic/manual assign/offer accept. Nullable equipment output description исправляет 500 без ослабления input/owner форм.
- [проверено] Автоподбор только quarry, accumulator выбирается вручную. Offer/decline/timeout 120s и retry 60s без повторного no-driver notice. Водитель без доступа не получает новые назначения, но завершает ранее назначенный/принятый рейс.
- [проверено] Public payload исключает inactive Material, owner detail сохраняет архивные связи. Live resource smoke: redaction/restore, trial idempotence water/septic/equipment/accumulator/firewood, free422/staging hidden, manual storage 10м³×1 ₽ + delivery0 =10 ₽, order payment409 и admin RBAC403. [Resources](reports/sprint26/live-resources.json).
- [проверено] Два полных QA-заказа на actual test DB/Redis и real ASGI handlers: idem checkout, manual gate, общий trial deadline driver/carrier, 6 статусов после expiry до completed, освобождение водителя, receipt/review и отдельные journey chains. [Orders](reports/sprint26/live-orders.json).
- [проверено] В CLI уведомления ограничены QA: подавлено 108 non-QA отправок, 68 jobs только QA. Per-order Redis lock исключил внешний dispatcher во время прогона. Это **API E2E**, а не полное оформление кликами в опубликованном web и не физический PUSH.
- [не начато] Полный published click-through checkout в отдельной ручной приёмке с QA получателями. Формы/карточки проверены browser tests, фактический business flow — API E2E.

### 26.5 — только платная вода, cleanup/import — проверено на test

- [проверено] В формах нет free choice; обязательны price>0, unit, contact/location. Запрет на partner/admin API и DB constraint. Проверены required fields и responsive формы на 6 размерах.
- [проверено] До удаления сохранены full pg_dump, private JSON.gz, preview SHA и зависимости. Удалены 6 free points и 5 media metadata; FK отсутствовали, audit0; S3 объекты сохранены для восстановления. [Preview](reports/sprint26/water-preview.json), [cleanup](reports/sprint26/water-cleanup.json), [backup](reports/sprint26/test-backup.json).
- [проверено] Реальный 2GIS reparse: 52 created; повтор 0 created/52 updated. 52 поставщика с неизвестной ценой остаются inactive/pending_moderation/auto_added, отсутствуют в public API. Старые 4 валидные paid точки сохранены, добавлена отдельная QA-точка; free0. [Import](reports/sprint26/water-import.json), [repeat](reports/sprint26/water-import-repeat.json).
- [проверено] Visual выявил активный legacy Material «Бесплатная вода»: catalog is_free=False/price120, один quarry offer0. Материал и его единственная связь архивированы по explicit UUID после backup/digest/dependency check; история и суммы не удалены/не пересчитаны. Public map/catalog больше его не возвращают. `scripts/sprint26_archive_legacy_water.py`, [report](reports/sprint26/legacy-water-material.json).
- [не начато] Проверка цен/контактов 52 поставщиков перед публикацией — операционная модерация. Не заменять неизвестную цену нулём.

### 26.6 — общий чат и модерация — проверено API/web

- [проверено] `general_chat.py`/GeneralChatScreen: text/poll5s/cursor/history/change pagination/idempotence/throttle, gate каждой операции. Admin имеет служебный доступ, moderator требует подписку; оплата не снимает санкции.
- [проверено] Delete/tombstone/warn/mute/unmute/ban/unban/remove/restore/moderator/rules/pin/audit/RBAC. Backend и browser checks send/offline draft/recovery/expiry во время открытого чата; переписка очищается после expiry.
- [проверено] Опубликованный чат send/pin/delete/warn только QA, 6 размеров/landscape/short keyboard viewport. [Live UI](reports/sprint26/live-ui-profiles-chat-journey.json).
- [заблокировано] Physical APK keyboard/PUSH: устройства и adb нет. Browser/no_device не доказательство.

### 26.7 — путь/ошибки, owner alerts, получение и отзыв — проверено API/web

- [проверено] `journey.py`/middleware/`journey.ts`: visitor/session/attempt, anonymous contact + verified link, серверная истина заказа/оплаты, повторные попытки/отдельные заказы/status catch-up, city validation, masked/encrypted contact и admin reveal audit.
- [проверено] Offline bounded queue/dedup/retry, запрет client success/secret metadata, pending не ошибка, recovery/late success/retention/idle, owner outbox/in-app settings. Focused observability/recovery tests.
- [проверено] AdminJourneysScreen: списки/фильтры/summary/transitions/chronology/attempts/orders/payments/notifications/settings/deeplinks. Published anonymous failure→verified login сохраняет историю; city filter, masked contact/reveal audit, offline flush/dedup. [Live UI](reports/sprint26/live-ui-profiles-chat-journey.json).
- [проверено] 3 QA login failures одной попытки →1 in-app QA admin после реальных 5 минут; ссылка открывает нужную chronology. [Owner](reports/sprint26/live-ui-owner.json).
- [проверено] OrderReviewPanel/Client Card: receipt и один отзыв1–5, idempotence/RBAC/backend; published web на completed QA order, 6 размеров +390×420, direct notice/no order payment. [Client](reports/sprint26/live-ui-client.json).
- [заблокировано] Physical PUSH и обычный SMS-вход с выделенным телефоном не подтверждены. Для пяти QA ролей обычный password login даёт HTTP200; driver сохраняет обязательную SMS challenge, Client JWT не заменяет обычный вход. [QA login](reports/sprint26/qa-manual-login.json).

## 5. Исходники, коммиты и рабочее дерево

- Workdir `/opt/darmavoz_test`, ветка **develop**. Последний коммит **приложения** и опубликованный release — **c3a8a29431fc247417b593fa6c34a391d5a7ca50**. Main/production не менялись.
- Коммиты: `6a7b95f1` foundation; `c07d678e` first release; `28a7b5ae` city/retry/renewal; `3adda8ba` refund limits; `0fd8dd19` contrast/SDK; `a378dc58` equipment/decline/archived offers; `49b5a050` pending UX; `c3a8a294` map cards/landscape/archive helper.
- Документы, отчёты/скриншоты и инструменты приёмки входят в заключительный docs/ops commit `[skip ci]`. Его SHA смотреть `git log -1`; он может быть новее app/runtime/APK SHA. Нового app кода после c3 нет, повторный deploy для одних отчётов не нужен.
- Снимок собственных изменений перед заключительным commit: этот файл, block/release/manual/index, JSON/PNG отчёты, manual sandbox/live UI helpers, расширенный isolated admin case, guarded live API/release probe/APK verifier/QA visual/manual login tools; test setup сохраняет приватные QA пароли при повторе. После фиксации собственных незакоммиченных наработок не должно оставаться; проверить фактический `git status`.
- Чужие исходные dirty **docs/README.md, docs/blocks/logist-drivers.md, docs/blocks/refunds.md** сохранены. Две наши README ссылки были закоммичены частично раньше. Старые untracked audits/screenshots/scripts не включать целиком; особенно `scripts/debug_b6a576_refund.py`. [Baseline](reports/sprint26/baseline.json).
- История передачи: [initial](reports/sprint26/checkpoint-history.md), [live](reports/sprint26/checkpoint-live-20261030.md), [acceptance](reports/sprint26/checkpoint-acceptance-20261030.md). Старые SHA/незавершённые статусы в этих снимках не заменяют текущий документ.

## 6. Фактическое тестовое развёртывание

**Опубликованы backend/web/APK c3a8a294.** Source HEAD после docs/ops commit может быть новее; runtime намеренно остаётся на app release. Проверено runtime git, root web build-info, health, image и хеши 6 критических backend файлов. [Deployment](reports/sprint26/test-deployment.json).

- Web: https://test.darmavoz.ru/app. Root `/build-info.json` отдаёт SHA; `/app/build-info.json` — SPA HTML.
- Backend image `sha256:7544b2bf6b2de6165e2722961dbf564eb04ed7c2cae1e8b9ae727dfb1f54c27b`, started `2026-10-30T14:34:11.068276742Z`, restart count0. Health online3.3.3.
- APK: [immutable file](https://test.darmavoz.ru/static/darmavoz-test-c3a8a29431fc247417b593fa6c34a391d5a7ca50.apk), 19,870,463 bytes, SHA256 `a1c571b65ee957bae23aa4c262c51f29759db6f29e83e584b9f6d8007402c0d6`. AppId `ru.darmavoz.app.test`, имя «Дармавоз ТЕСТ», версия3.3.3/code391, test API. [Artifact](reports/sprint26/android-artifact.json). Встроенного commit marker в JS нет: identity по имени/CI manifest/hash. Physical не проверен.
- Схема **s26_subscription_platform**. `enabled/direct_orders/water_paid_only/chat_enabled/journey_enabled=true`. 17 legacy grants; 32 draft commercial/32 QA1₽ plans +QA10₽/3months. Owner alerts только QA admin. Исторические order payments9/refunds2 сохранены.
- [Test deploy](https://github.com/daoosai/darmavoz/actions/runs/41071285103) и [Test APK](https://github.com/daoosai/darmavoz/actions/runs/41071285089) success. Проверены только test workflows, production не запускался.
- Private backups/credentials `/opt/darmavoz_test_backups/sprint26/`0700, файлы0600. Не печатать password/OTP/tokens/confirmation URLs/.env. Provider inspection images хранятся приватно вне Git.
- `scripts/sprint26_qa_manual_login.py --prepare` создаёт недостающие пароли только выделенных test QA профилей, сохраняет их приватно. Без флага проверяет пять password логинов; driver не запрашивает SMS автоматически. Для driver/client нужен контролируемый QA телефон, auth bypass не добавлен.
- Actual test runner `/tmp/s26-test-runtime-run.py`: guarded test DB/test shop/source bind/private backup bind; CLI SMS/FCM off. Не запускать во время Docker prune/recreate из CI — ранее был NoSuchImage без изменения данных.
- Isolated s26_qa_* /18026, pytest DB_UUID, clone s26_migration_test. Fresh Vite18264→isolated18026. Local visual18263→actual test API с placeholder SDK key (layout-only); его снимки перезаписаны опубликованными. Preview18262 без API proxy не подходит для build с relative API.

## 7. Проверки, ограничения и вопросы до production

- Последняя CI c3: **284 backend passed (88.60s),172 Playwright passed (6.9m)**; npmrunlint(=TypeScript)/frontend build success. [CI](reports/sprint26/ci-final.json). Предыдущая CI49 сохранена отдельно.
- После layout: **10 isolated browser passed (1.8m)**, расширенный admin case1passed32s; resource backend6passed15.65s; lint/TS/build pass. [Follow-up](reports/sprint26/map-layout-followup.json). Один запуск preview без API proxy вернул SPA HTML; окружение исправлено, ошибку не выдавали за дефект приложения.
- Адресные наборы:23access/34billing/30equipment-decline-observability; fresh/clone migrations checked. Весь исторический pytest не объявляется зелёным: sprint18 relevance и старые dispatch fixtures воспроизведены на clean907182ae; S26/current CI проходят.
- Опубликованный web:42 профиля/карты/карточки, live chat/journey/owner/client checks; representative screenshots просмотрены вручную, автоматические geometry/hit checks на 6 размерах. [Screenshot index](reports/sprint26/screenshots/README.md), [release report](reports/sprint26/TEST_RELEASE.md).
- [заблокировано] Нет физического устройства/adb и контролируемого SMS-получателя: APK install/runtime/WebView/insets/реальная клавиатура/PUSH foreground-background-terminated не подтверждены. [Точная ручная приёмка](reports/sprint26/MANUAL_ACCEPTANCE.md).
- [реализовано без проверки live] Terminal bank canceled; [не начато] полный published checkout click-through. Actual API E2E и отдельные UI проверки выполнены, ограничения отражены в отчёте.
- [не начато, требует заказчика] Утверждение commercial тарифов (особенно equipment/carrier), правил полного/partial refund и изменения доступа, чеки/VAT/legal/privacy/retention/спорные владельцы и номера. Цены/контакты52water кандидатов проверить до публикации. Автосписания/store billing вне объёма.
- Production image/start/restart count и оба .env совпадают baseline. Никаких production операций не разрешено. Версии не повышались, серверные .env не редактировались.

## 8. Продолжить отсюда

**Следующая подзадача — ручная приёмка на выделенном физическом Android/планшете и согласование коммерческих условий.** Реализацию заново не начинать. Не повторять покупки ЮKassa, миграции, water cleanup/import и уже прошедшие проверки без новой причины.

1. Прочитать инструкции и `git status`; сравнить app release c3 с runtime/web/APK и последующим docs/ops HEAD. Все отчёты находятся в `docs/reports/sprint26/`. Проверить отсутствие private `qa-visual-access.json`; если он есть после прерывания — сначала восстановить исходные даты guarded visual helper.
2. Для физического теста — immutable APK выше, SHA256, выделенные QA аккаунты/телефон/FCM устройство; выполнить `MANUAL_ACCEPTANCE.md`, записать реальную модель/Android/версию/время/результат и снимки. `no_device` не отмечать успехом. Driver SMS остаётся обязательным; пароль не заменяет второй фактор.
3. Отдельно пройти полный UI checkout с QA-only получателями. Прежний live API E2E уже завершён: не повторять его как замену пользовательских кликов. Не посылать уведомления настоящим клиентам/сотрудникам для проверки.
4. Утвердить тарифы/возвраты/правила доступа и остальные commercial/legal вопросы; до этого сохранять draft/null, не придумывать цену carrier. 52 водных кандидата публиковать только после модерации цены/контактов.
5. Если обнаружен дефект — исправлять только source develop/test, проверять нужный сценарий и вёрстку, обновлять этот документ вместе с кодом. Перед push перечитать workflows; во время deploy не менять source HEAD (stale-source guard). Production/main/.env/version не трогать.
6. Если сессия прерывается — зафиксировать незакоммиченные файлы, результаты и конкретный следующий шаг здесь. Финальный docs/ops commit не требует пересборки приложения; не путать его с опубликованным c3 release.
