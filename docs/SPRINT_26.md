# Спринт 26 — единый документ передачи и состояния работы

**Следующей сессии:** сначала прочитать этот файл, `/opt/darmavoz_test/AGENTS.md`, README и применимые `.github/workflows/` **на ноде**. Проверить `git status`, актуальные ветки и фактически запущенный тестовый контур. Затем продолжить с раздела **«Продолжить отсюда»**. Чужие и неизвестные изменения не перезаписывать, не сбрасывать и не включать в свои коммиты. История чата для продолжения не требуется.

Обновлено: 2026-10-30 UTC. Общий статус: **реализация 26.1–26.7 написана; финальная проверка и доставка тестового выпуска в работе**. Этот документ — основной источник передачи работы. Старые `sprint26-plan.md` и `sprint26-progress.md` сохранены как контекст, но их промежуточные статусы могут отставать.

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

Статусы: **не начато / в работе / реализовано без проверки / проверено / заблокировано**. Isolated, live web/API, фактическая публикация и физический телефон — разные виды проверки. Общую приёмку не объявлять завершённой при существенных остатках.

### 26.1 — основание, миграция, безопасный переход — проверено

- [проверено] Инструкции ноды/README/workflows, baseline, сохранность3чужихdirtydocs, работа только develop/test.
- [проверено] Frozen additive migration `s26_subscription_platform`, parent `release_317_merge_heads`:18таблиц +vehicle plate_key/order settlement_mode/next_dispatch_at. Fresh isolated upgrade/downgrade/re-upgrade и round trip на приватном клоне test backup.
- [проверено] Clone исторические строки не изменились:127orders,9payments,2refunds и digest связанных сущностей. [Migration report](reports/sprint26/migration-clone.json), воспроизводимый `scripts/sprint26_migration_smoke.py` разрешён только disposable DB.
- [проверено] Transition preview/apply сохраняет подтверждённые даты, ownerless resource scopes и дедупликацию. На test перенесено17grants;17неподтверждённых ресурсов на review,68невалидных исторических тестовых номеров не получили придуманныйtrial.
- [проверено] Эта миграция применена на test runtime, пять S26 flags включены. Production миграции не запускались.

### 26.2 — подписки, trial, тарифы, автопарк, админка — реализовано, финальная visual проверка в работе

- [проверено] Account+8categories, explicit14days, UTC boundaries, HMAC identity/normalized RU plate registry, concurrency/re-registration/mixed fleet/paid override. Driver↔carrier и новая машина не продлевают исходный deadline. Access focused23pass; последующая regressionCI.
- [проверено] Draft коммерческие планы, null carrier, test-only plans отдельно; admin RBAC/manual grants/спорный номер/история/поиск аккаунта/settings/transition/audit. Новые auth роли не создавались.
- [проверено] SubscriptionsScreen4профессиональных ролей, activation/history, uncertain idempotent retry и renewal. Admin plans/payments/refunds/source decision forms. Responsive6размеров и short keyboard viewports, текущий дизайн сохранён.
- [проверено] DriverSubscriptionNotice/общая карта без доступа: найден и исправлен белый текст на белой кнопке, отдельный browser contrast/maps case1pass. SDK zoom перекрывал embedded toolbar — для новых embedded карт bottomLeft+trackResize, standalone положение сохранено.
- [в работе] Финальные real-SDK screenshots после последнего deploy. QA водитель теперь имеет trial: для notice использовать scoped helper expire→browser→restore с private snapshot, не сбрасывать trial историю.

### 26.3 — деньги только за подписки, billing/refunds, совместимость — проверено, final deployed smoke в работе

- [проверено] Durable jobs, immutable snapshot, stable request/idempotence keys, authenticated provider GET, webhook/replay, late binding, recovery/restart, 23h no-repeat POST boundary, receipts/history. Старые платежи/refunds обслуживаются, новый order-payment запрещён (в т.ч. прежний APK endpoint).
- [проверено] Тестовый магазин/ключ (значения не выводились). Реальный pending пережил force-recreate backend_test с прежними provider/key IDs и grants0; после оплаты ровно1sourcegrant.
- [проверено] Live sandbox3покупки; partial3₽из10₽, отдельный UI keep; full1₽из1₽, UI revoke только последнегоsourcegrant. [Partial](reports/sprint26/sandbox-refund.json), [full](reports/sprint26/sandbox-full-refund.json). Другие основания доступа сохранены. Коммерческую policy не придумывали.
- [проверено] 0,40из1₽ отвергнут ЮKassaHTTP400 amount.value. Добавлены server/UI технические partial bounds (>=1₽, остаток0или>=1₽);6boundary cases. [Diagnostic](reports/sprint26/sandbox-provider-limit.json).
- [проверено] Реальная SDK карточная попытка «Не хватает денег», parent **pending**, затем тот же payment успешно оплачен test wallet. Pending не failed; [card observation](reports/sprint26/sandbox-card-attempt.json). Реквизиты не логировались, автосписания отключены.
- [проверено] Final provider canceled с allowlisted bank reason классифицируется failed attempt/provider_rejected, осознанная отмена canceled/user_cancelled; late binding/replay/owner selection покрыты backend tests. UI различает transient pending, банк и сверку. Browser regression1pass14.1s.
- [проверено] Public webhook replay2payments/1refund не менял grants, повтор создания использовал ту же операцию, attempts succeeded/renewal audit+event. [Ledger](reports/sprint26/live-sandbox-ledger.json). Повторить финальный snapshot после3йпокупки/fullrefund.
- [реализовано без проверки] Именно **окончательный live bank canceled** не был получен: hosted checkout оставил parentpending для retry. Этот исход проверен изолированно; не выдавать его за live webhook отказа.

### 26.4 — capabilities, точки/контакты, заказы и dispatch — реализовано, live resources в работе

- [проверено] Approved expired точки видны серыми; телефон/description/raw parsed_data скрыты; manual hidden/archive/internalCRM не раскрываются. Pricing/checkout/wholesale/equipment/water/septic/manual assign/offer accept gated сервером.
- [проверено] Автоподбор толькоquarry, накопительmanual.120s offer/decline/timeout +60s retry без повторного no-driver notice. Новые S26 handoff tests с корректными city/category fixtures; обходы directAPI/manual закрыты.
- [проверено] Actual test DB/Redis E2E двухQAзаказов: accumulator checkout10м³×1₽+delivery0, idem retry, order payment409, driver manual admission409, driver/carrier общийtrialdeadline, assigned trip после expiry прошёл6статусов до completed, водительfree. Separate order chains; received/review idem. [Order E2E](reports/sprint26/live-orders.json).
- [проверено] ASGI E2E использовал реальные handlers+testDB/Redis. Notification transport CLI ограниченQA, external worker исключён per-order lock;108non-QA deliveries подавлены,68jobs толькоQA. Это не клики оформления в публичном web и не physicalPUSH.
- [проверено] Live resource smoke выявил equipment500: descriptionNone при сокрытии контактов не принимался outputDTO. Исправлены nullable output/frontendtype; input/owner формы не ослаблены. List/detail redaction+restore tests passed.
- [проверено] Public point offers исключают inactiveMaterial, чтобы архивный «Бесплатная вода» не возвращался через фильтр карты. Owner detail сохраняет архивные связи; global/detail test passed.
- [в работе] После последнего deploy завершить live `resources`: equipment before/after access, accumulator/firewood, freeAPI refusal, publicstaginghidden, pricing/manualstorage/RBAC. Water/septic QA trials уже активированы, повтор не продлевает.

### 26.5 — только платные точки воды, cleanup/import — проверено, final API smoke в работе

- [проверено] Partner/admin формы без free choice, обязательные price>0/unit/contact/location; gate всех записывающихAPI и DB check. UI6размеров, прежний бесплатныйsubtitle убран.
- [проверено] До удаления fullpg_dump +privateJSON.gz, SHA preview/dependencies checked. Удалено6free water_points+5media metadata, FK отсутствуют/audit0; S3objects сохранены для восстановления. [Preview](reports/sprint26/water-preview.json), [cleanup](reports/sprint26/water-cleanup.json), [backup](reports/sprint26/test-backup.json).
- [проверено] Actual2GIS commercial reparse52создано; repeat0created/52updated.52unknown inactive/pending_moderation/auto_added не опубликованы, цена не выдумана. [Import](reports/sprint26/water-import.json), [repeat](reports/sprint26/water-import-repeat.json). Старые4paid валидны, free0; дополнительно отдельнаяQApaidточка.
- [в работе] Final live free-rejection/staging invisibility через `resources`. Верификация цен52поставщиков перед публикацией — операционная работа, а не подстановка нуля.

### 26.6 — общий чат и модерация — проверено web/API

- [проверено] Text/poll5s/cursor/history/change pagination/dedup/send throttle; доступ каждой операции, admin service bypass, moderator требует subscription, оплата не снимает sanction.
- [проверено] Delete/tombstone/warn/mute/unmute/ban/unban/remove/restore/moderator/rules/pin/audit. Backend checks и browser moderation/send/offline recovery/expiry во время открытого чата.
- [проверено] Published test chat send/pin/delete/offline draft и in-appwarn толькоQA. Responsive/landscape/shortkeyboard screenshots, messages очищаются после expiry, CTA/recovery работают.
- [реализовано без проверки] Физический PUSH/keyboard/AndroidWebView не подтверждён — устройства нет; no_device не успех.

### 26.7 — путь посетителя, ошибки, owner alerts, получение/отзыв — проверено web/API

- [проверено] Visitor/session/attempt, anonymous contact attempt, verified account link только после backendlogin, server order/payment truth, retries/multi-order child chains и status catch-up. Masked/encrypted contacts/admin reveal audit; city header валидируется, неизвестный город не угадывается.
- [проверено] Offline bounded queue/dedup/retry, запрещены client success/secret metadata, pending не ошибка, incidents/recovery/late success, retention/idle, owner outbox/inapp settings. Targeted observability/recovery passed.
- [проверено] Admin list/filters/summary/transitions/chronology/attempts/orders/payments/delivery/settings/deeplinks. Live anonymous failure→verified login с сохранением истории/cityfilter, audited reveal, offline flush, no duplicates/secrets. [LiveUI](reports/sprint26/live-ui-profiles-chat-journey.json).
- [проверено] Реальные5min inputgroup:3неуспешныхQAвхода→1inapp толькоQAadmin; notification link открывает нужную chronology. [Owner](reports/sprint26/live-ui-owner.json).
- [проверено] Client received+one5starreview: backend/isolatedresponsive и **опубликованный web** на втором completedQAзаказе,6размеров+390×420keyboardviewport; direct notice/no order payment. [Client](reports/sprint26/live-ui-client.json).
- [реализовано без проверки] Physical PUSH/APK и внешняя SMS/email доставка не проверялись на клиентах; требуется выделенное устройство/QAполучатель.

## 5. Исходники и рабочее дерево

- Workdir `/opt/darmavoz_test`, branch **develop**, source/origin **49b5a050c41cb6c8cb59effe9e34c94267524e0f** (pushed). Main/production не менялись.
- Коммиты:6a7b95f1foundation; c07d678efirstrelease/gates/water;28a7b5aeanalyticscity/retry/renewal;3adda8barefundlimits;0fd8dd19map/readability;a378dc58equipment/decline/archivedoffers;49b5a050pendingUXregression.
- Собственные dirty: этот handover/block/report/screenshotupdates, `scripts/sprint26_live_api_smoke.py`, `scripts/sprint26_qa_visual_access.py`, sandbox-refund helper full-mode. Уточнять по gitstatus: приложение уже закоммичено, ops/report файлы могут дополняться до финальной проверки.
- Чужие исходные dirty: **docs/README.md, docs/blocks/logist-drivers.md, docs/blocks/refunds.md**. Наши2READMElinks были staged частично, остальной foreigndiff сохранён. Старые untracked audit/screenshots/scripts не stage целиком, особенноdebug_b6a576_refund.py. [Baseline](reports/sprint26/baseline.json).
- Основное: app/models/subscriptions.py; frozen migration; services subscriptions/subscription_billing/subscription_transition/sprint26_worker/journey/middleware; API subscriptions/general_chat/journeys и capabilities существующихэндпоинтов. UI использует CommerceShell/commerceApi. Tests test_sprint26_*.py +opt-in sprint26-isolated.spec.ts.

## 6. Развёртывание и QA инфраструктура

**Снимок перед финальной CI:** runtime/public web **0fd8dd19**. Новый source49b5a050 CI в работе; a378dc58 промежуточный deploy тоже мог завершиться — сверить actual, не гадать по описанию.

- Миграция **s26_subscription_platform**, flagsenabled/direct_orders/water_paid_only/chat_enabled/journey_enabled=true.17legacygrants/32draftcommercial/32QA1₽plans +отдельныйQA10₽3months; owner alerts толькоQAadmin.
- Web https://test.darmavoz.ru/app. Root `/build-info.json` отдаёт SHA; `/app/build-info.json` — SPAHTML, не использовать для проверки.
- Version **3.3.3/build391**, без повышения. APKCI делает отдельные appId **ru.darmavoz.app.test**/имя «Дармавоз ТЕСТ», testAPI/testS3/TestFirebase, source production appId не меняется. Проверить manifest/ZIP compiledtestAPI и HTTP SHA immutableartifact после последнегоCI.
- Предыдущий проверенный APKc07 доступен immutableпоSHA, но **не отдавать его как финальный49release**. Final link/hash/report заменить послеCI: `/static/darmavoz-test-<fullSHA>.apk`, manifest `/static/darmavoz-test-build.json`.
- Test Actions: latest [deploy49](https://github.com/daoosai/darmavoz/actions/runs/41041952339), [APK49](https://github.com/daoosai/darmavoz/actions/runs/41041952675); промежуточный [deploya378](https://github.com/daoosai/darmavoz/actions/runs/41041157088). Только test workflows, productionне запускался.
- Private QA credentials/snapshots/backups **внеgit**, `/opt/darmavoz_test_backups/sprint26/`0700, файлы0600. Не печатать токены/пароли/confirmationURLs. Setup --enable идемпотентен и сохраняет private QA probe keys; без нужды не повторять.
- Runtime runner `/tmp/s26-test-runtime-run.py` guarded testDB/testshop/sourcebind, CLI SMS/FCMoff. **Не запускать во время CI Dockerprune/recreate** — был NoSuchImage, без изменений данных.
- Isolated: s26_qa_postgres/s26_qa_redis/s26_qa_backend port18026; Vite18260/18261, preview18262. Pytest собственная darmavoz_test_db_UUID. Clone s26_migration_test безappworkers. Не путать с actualtestDB.

## 7. Проверки, ограничения и вопросы

- CI28a: **272backendpassed /172Playwrightpassed**. [Counts](reports/sprint26/ci-28a-counts.json). Поздние fix наборы:34refundlimits,30equipment/decline/observability,5resource; TS/lint/buildpassed. Новыеbrowsercontrast1pass13.6s/pending1pass14.1s.
- Isolated основные8casespassed1.5min; ****финальный10case после всехfix:10passed(1.6min)****, лог `/tmp/s26-final-isolated-browser.log`. Screenshotsв reports/sprint26/screenshots/; финальный screenshot index/visual report ещё записать.
- Fresh/clone migration roundtrip и transitionpreserved, screenshotreview обнаруженныеblankbutton/mapcontrols исправлены. Имена логов.log gitignored; сохранить безопасные counts/results вmd/json.
- Исторический весьpytest **не объявлять зелёным**: sprint18relevance и старые dispatchflowfixtures воспроизведены на чистом907182ae. S26focused/currentCI зелёные, fullhistoricalbaselinefailures documented в checkpoint-history.md.
- **Physical device нет (adbотсутствует)**: настоящий APKinstall/runtime/safearea/keyboard/PUSH не подтверждены; build/browser/no_device их не заменяют. Подготовить manual checklist и указать ограничение в финале.
- Live parentpaymentcanceledbankdecline не получен, SDK предоставилretry; terminal rejection/ownerfilter проверены isolated. Реальная карточная попытка и recovery проверены без денег.
- Коммерческие вопросы доproduction: подтверждение всех тарифов/equipment/carrier, полных/частичныхrefund и доступа, receipts/VAT/legal/privacy, disputedlegacyowners/номеров иantiabuseretention.52импортированныхsellerцен требуют проверки до публикации. Автосписания/storebilling не входят.
- Production image/start/restarts и оба.env hashes совпали baseline: [unchanged](reports/sprint26/production-unchanged.json). Повторить read-only сверку в конце; не приписывать testCI какие-либо prodизменения.

## 8. Продолжить отсюда

**Следующая подзадача:** дождаться **49b5a050 testdeploy/APK** (и окончания промежуточногоa378deploy), затем выполнить final live resources/ledger и realSDKvisual. Не начинать заново реализацию/банкпокупки/cleanup.

1. Прочитатьgitstatus/actualruntime/Actions через node `/tmp/s26-actions.py`; source49 ужеpushed. Сверить frontendrootbuildinfo, runtimegitSHA/image/health/schema/settings. Не запускать параллельные миграции.
2. Получить завершение10case isolatedbrowser log; при успехе сохранить точныйcount/duration. Если теступал, исправить причину и проверить, не прикрыватьrepeatуспехом.
3. ПослеCIprune: guarded `python -m scripts.sprint26_live_api_smoke resources`, затем`sandbox`. СохранитьJSONотчёты. Сейчас live ресурсы остановились на equipment500старогоruntime; исходныйfix ужеunitpass/commit. Sandbox должен учесть3покупки/2refunds/1revokedsource, другиеgrantsнеизменны. Header/phone/RBAC/free checks.
4. Final realSDKnotice/maps: scoped `scripts/sprint26_qa_visual_access.py expire` → `frontend/tests/manual/sprint26-live-ui.cjs profiles` → **restore вfinally**. Private snapshot переживает interruption; при его наличии сначалаrestore. ТолькоQA driver, безassignedorders/paidgrantизменений. Просмотреть screenshots с исправленным contrast и controls; сохранитьindex. Отдельныеpointcards проверить при возможности.
5. Скачать immutable49APK, сверитьmanifest/fullSHA/SHA256/размер/appIdtest/testAPI/assets/version3.3.3code391. Записать android-artifact.json и final test-deployment.json, получить точныеCIcounts изjoblogs.
6. Проверитьpreservedproductionimage/start/restart/envhashes read-only. Обновить этотфайл иblock/report по фактам. Своиops/scripts/reports/screenshots закоммитить; puredocs/ops `[skip ci]` допустим, **code release49/runtime/APK различать от docscommit**. Чужие3docs и исходныеuntracked не stage.
7. Финал: этапы/остатки, web+immutableAPK, commits/migration/flags, auto/E2E/visual/screenshots, physical+commercial+providerobservabilityограничения, краткаяручнаяприёмка, productionнеизменялся. Не объявлятьобщуюприёмку завершённой безустройства/существенныхостатков.

CI a378:backend/frontend tests успешны, deploy остановлен вCreateincrementalsourcebundle защитой от устаревшей сборки: sourceHEAD уже49, a378неявляетсяего потомком. Это не ошибка тестов. Ничего не коммитить до завершения49deploy, иначе та же проверка справедливо отклонит49.


### Текущий промежуточный результат — 30.10.2026 14:10 UTC

- Final CI49: **284 backend passed (98.96s), 172 Playwright passed (8.3m)**; lint/TypeScript/build success, testdeploy/APK success. Отчёт `reports/sprint26/ci-final.json`. Отдельный isolatedbrowser:10passed.
- Actual runtime/web/APK49 проверены; APK package ru.darmavoz.app.test,3.3.3/code391,SHA2567ee90c74af33fdf657c82b4c1d9f37bff2ea8052e4c6523e4b04f7ab60ade3d9. Проба14:07UTC подтвердила обе .env и production image/start/restarts неизменными.
- Finalresources smoke и providerledger завершены:3successfulQApayments/2refunds/1sourcegrant revoked, replay без дублей. RealSDK profiles helper формальноpass36captures, QAtrial snapshot восстановлен и удалён.
- **Ручной просмотр снимков обнаружил остатки, поэтому visual приёмка ещё не закрыта:** в фильтре GlobalMap остался «Бесплатная вода» (publicAPI действительно ещё возвращает этот material — выяснить active/seed причину), SDKzoom/locator перекрывают выбранную storagecard, watercard на844×390 может быть обрезана родителем min-height480/overflowhidden. Проверить прокрутку/закрытие и исправить по фактам. Auto horizontal-overflow check этого не заметил; не выдавать helperpass за полную visual проверку.
- **Продолжить отсюда сейчас:** разобраться с publicfreewater material; изолировать SDKcontrols в собственном stacking context, обеспечить видимый scrollable watercard на низком viewport; добавить адресные regression проверки hit-testing/scroll, обновить source/testrelease/APK если меняется приложение. Не повторять покупки/cleanup/миграции. Затем финальные отчёты и docs/opscommit.


### Уточнение текущей подзадачи — 30.10.2026 14:24 UTC

- Legacy материал `821cfe07-a343-4734-9f4f-9a9131ccdec7` был **активен**, is_free=False/catalogprice120, но единственное предложение0₽; поэтому предыдущий inactive-filter не мог его убрать. На test выполнено явное архивирование материала и его1предложения, без удаления/пересчёта истории. Preview SHA10bc439cde91..., backup verified0600, зависимости cart0/order_items0/wholesale0; publiccatalog/globalmap отсутствие проверено. Script `scripts/sprint26_archive_legacy_water.py`, отчёт `reports/sprint26/legacy-water-material.json`. Не запускать повторно без нового preview.
- В исходниках исправлены CommerceShell fillHeight (только новая общая карта), embedded minheight/landscape headers и состояния; SDK canvas/controls ограничены собственным stacking context, locator ниже карточки, Water/Septic sheets fixed с viewportbound/внутренней прокруткой/stickyclose. Текущий стиль сохранён.
- npmrunlint (TypeScript) + build pass;6resource backend tests15.65s pass. Полный isolatedbrowser повтор после layoutfix: **10 passed (1.8m)**. Fresh Vite18264 использует только disposable18026; прежний preview18262 безAPIproxy возвращалHTML, это исправленная конфигурация проверки.
- Local actual SDK DOM/control layout:36captures +hit testing close/route/contact и scroll в6размерах pass; localplaceholderkey не даёт картографические tiles, это **не доказательство работы published SDK tiles**. После testCI повторить default published profiles helper, визуально просмотреть снимки с действующим webkey. QAtrial restored, snapshot отсутствует.
- Сейчас **code49 ещё опубликован**, новые4UIфайла/helper/backupscript ожидают commit/testCI. Следующийшаг: commit/push develop после просмотра diff, дождаться только testdeploy/APK, затем обновить releaseSHA/CIcounts/probe/artifact/screenshots/финальныйдокумент. Коммиты во время deploy не делать (stale source guard).
