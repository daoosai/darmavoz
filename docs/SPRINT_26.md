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

## 4. Чек-лист 26.1–26.7

Статусы: **не начато**, **в работе**, **реализовано без проверки**, **проверено**, **заблокировано**. «Проверено» относится только к описанным проверкам, не означает live release. Ни один этап целиком ещё не завершён.

### 26.1 — основание, схема, безопасный переход — в работе

- [проверено] Проверены node instructions/workflows, исходный git/runtime, сохранён baseline и чужие dirty docs.
- [проверено] Единый handover (этот файл) создан на сервере и обновляется после подзадач; сверять перед продолжением.
- [проверено] Additive Alembic `s26_subscription_platform`: 18 новых таблиц + vehicle plate_key, order settlement_mode/next_dispatch_at. Fresh disposable DB upgrade проверен. Даты/финансовая история не перезаписываются миграцией.
- [проверено] Upgrade/downgrade/re-upgrade и topology test прошли в адресной группе 33 tests и CI-equivalent 250 tests. Применение на runtime пока не выполнялось.
- [реализовано без проверки] `subscription_transition.py`: preview/copy подтверждённых сроков/identity и vehicle membership, ownerless resource grants, список неизвестных сроков/номеров; admin endpoints. **Не запускалось на runtime DB.**
- [не начато] Проверка перехода на копии тестовых данных, отчёт dry-run и применение на test.

### 26.2 — единые подписки/trial/автопарк — в работе

- [проверено] Category access, trial/контактный реестр, plate normalization + shared driver/carrier ledger, календарные месяцы и точная граница expiry; mixed fleet и paid override — адресные isolated tests.
- [проверено] Draft plans с carrier null; исправлено создание черновиков при наличии QA plans. API role checks проверены.
- [проверено] Admin API role checks/accounts/draft null-price/транспортный реестр и source grant decisions проверены адресно. Полная concurrency/смена машины/спорные случаи в UI ещё требуют проверки.
- [проверено] SubscriptionsScreen/menu доступны всем четырём профессиональным ролям; supplier trial activation и responsive 360/390/768/1024/1440/844 landscape прошли в isolated Playwright. История реального test-shop платежа пока не подтверждена.
- [реализовано без проверки] AdminSubscriptionsScreen: plans/payments/refunds/access decisions/grants/plate review/settings/transition preview/audit; menu для admin. Добавлены API account search/vehicle history. Визуальная проверка и отдельные API tests ещё нужны; привязка владельцев и причины у логиста остаются.

### 26.3 — подписная оплата/возвраты и прямые расчёты — в работе

- [проверено] Сервисы payment snapshot/idempotence, provider validation, grant once, refund balance/source-only adjustment/review — isolated unit/service tests.
- [проверено] Durable retry на новой DB session, webhook replay, external refund import, explicit keep decision/replay/conflict и 23h no-repeat POST проверены в recovery tests. Фактический restart runtime/test-shop/webhook нужен отдельно.
- [проверено] Direct settlement notice виден в клиентской карточке, старой кнопки оплаты нет (isolated Playwright). Backend запрет новых платежей реализован; существующие финансовые regression tests прошли в группе 250.
- [не начато] Сквозной checkout/history/refund в тестовом магазине, late confirmation/restart, UI admin subscriptions refunds, согласованные receipt fields.
- [не начато] Проверка совместимости существующих order payment/refund тестов и старых APK endpoints.

### 26.4 — ограничения каталога, карт, заказов, диспетчеризации — в работе

- [реализовано без проверки] SQL transport predicate включён в driver_constraints; point visibility/orderability разделены, resource grants/trial учитываются pricing/cart/checkout.
- [реализовано без проверки] Public equipment/water/septic сериализация скрывает contact fields без доступа; equipment application gate; новые capability fields в DTO.
- [реализовано без проверки] Central manual assign/offer/accept admission проверяет точку; no_driver_found получает повтор поиска по таймеру с сохранением penalty logic. Последние изменения требуют тестов.
- [проверено] Четыре новых isolated resource tests: expired point map/detail + pricing rejection + grant restore, water/septic phone redaction/owner access, admission + завершение принятого рейса после expiry, due retry без повторных уведомлений. Отчёт: [resource-gates.md](reports/sprint26/resource-gates.md).
- [не начато] Полный аудит всех contact surfaces (включая raw parsed_data, descriptions, nested owner fields, legacy catalog/routes); точечные API tests на отсутствие утечек.
- [не начато] Проверить отсутствие обходов manual/direct API, expire pending offers; доказать завершение уже принятого рейса после expiry; frontend gray markers/disabled actions для всех категорий.

### 26.5 — платная вода, backup/cleanup/import — в работе

- [проверено] Feature-conditional API + raw DB trigger запрещают free/invalid paid; unknown разрешён только внутреннему неактивному staging. Dedicated API/DB тесты прошли.
- [реализовано без проверки] Free options убраны из partner/admin форм и карты; сохранены цена и объём/единица цены. Проверка самих форм/карты в браузере ещё нужна. DB guard/migration уже проверен.
- [не начато] Test backup + preliminary list + зависимости; безопасное удаление free records/media metadata с сохранением backup.
- [не начато] Reparse только продавцов, staging unknown prices/дедупликация, проверка карты и повторного запуска.

### 26.6 — общий чат и модерация — в работе

- [проверено] API read/write access, идемпотентная отправка, expiry, moderator expiry, ban/remove/unban/restore/mute, pin/delete tombstone — isolated API tests.
- [реализовано без проверки] Курсоры сообщений/модерации, предупреждения через existing outbox, правила, admin role management/audit. Нет тестовых отправок реальным аккаунтам.
- [проверено] Isolated Playwright: send, offline draft recovery, pin/delete и responsive all widths без horizontal overflow. Подписная блокировка API проверена. После visual добавлен scroll-to-latest/new message indicator; эту позднюю правку повторить.
- [не начато] Сквозная проверка нескольких QA участников, длинных текстов/keyboard/orientations, expiry во время просмотра, warning delivery на QA.

### 26.7 — контроль пути, админка, получение/отзыв — в работе

- [проверено] Journey models/API/service: anonymous event dedupe, запрет клиентского success/секретных полей, encrypted/masked contact, verified identity link/RBAC; pending не failed, late success снимает abandonment — isolated tests.
- [реализовано без проверки] Auth/order/payment middleware markers, maintenance/retention/owner alerts, server JWT hook, query logging выключен. Полный набор точек server instrumentation ещё не подключён/проверен.
- [реализовано без проверки] frontend `journey.ts`: visitor/session/attempt, bounded contact-free offline queue, fetch correlation, auth/cart/subscription hooks. Нужны browser/network/retry/PII tests, проверить все auth routes.
- [проверено] Received/review API ownership/idempotence + frontend OrderReviewPanel в существующей карточке проверены backend/isolated Playwright. Рейтинг сохраняется один раз, direct settlement notice отображается.
- [реализовано без проверки] AdminJourneysScreen/URL/filters/aggregates/transitions/chronology/notifications/settings написаны; responsive основного списка проверен, detail/filter/notification deep links требуют дальнейшего сценария. Received/review уже проверен.
- [реализовано без проверки] Delivery/status/renewal/expiry events и SMTP background failure instrumentation подключены. Dedicated observability tests: 7 passed в группе с chat/journey (anonymous failed login, single QA owner alert, no OTP log, monotonic success, recreated plate deadline). Последние provider error/recovery changes ещё проверять; real PUSH не подтверждён.

### Выпуск и общая приёмка — не начато

- [не начато] Полный backend набор + миграции на isolated DB + concurrency/restart/legacy regressions.
- [проверено] TypeScript и frontend build успешны для промежуточного снимка. После новых изменений повторить финальные проверки.
- [в работе] Isolated Playwright 4 passed; responsive 360/390/768/1024/1440 + 844 landscape, скриншоты сохранены и выборочно просмотрены. Live test.darmavoz.ru E2E и финальный visual sign-off ещё нужны.
- [не начато] Commit/push develop, test Actions и фактический backend/web deploy, test DB transition/water cleanup, test APK артефакт/SHA/hash.
- [не начато] Physical APK/PUSH: устройство пока не обнаружено/не проверено; это ограничение нужно честно описать и подготовить точные ручные шаги.
- [не начато] Финальный отчёт, ручная приёмка, сравнение production/env baseline.

## 5. Фактическое состояние исходников и артефактов

На 2026-10-30: `/opt/darmavoz_test`, branch **develop**, HEAD **6a7b95f1b4b0110369591324b20912a8a28b330e** — первый кодовый checkpoint Спринта 26. Push/deploy спринта **не было**. После checkpoint работа продолжается; незакоммиченные изменения проверять по git status. Перед commit заново проверить remote refs и рабочее дерево.

Основные новые файлы:

- `alembic/versions/s26_subscription_platform.py`, `app/models/subscriptions.py` — frozen schema/ORM.
- `app/services/subscriptions.py`, `subscription_transition.py`, `subscription_billing.py`, `sprint26_worker.py` — доступ, перенос, финансы/worker.
- `app/api/subscriptions.py`, `app/api/general_chat.py`, `app/api/journeys.py` — новые API.
- `app/services/journey.py`, `journey_middleware.py` — приватность, события/корреляция/уведомления.
- `frontend/src/SubscriptionsScreen.tsx`, `GeneralChatScreen.tsx`, `AdminSubscriptionsScreen.tsx`, `journey.ts` — новые интерфейсы/сбор событий.
- `tests/test_sprint26_subscriptions.py`, `tests/test_sprint26_chat_journey.py`, `tests/test_sprint26_resource_gates.py` — адресные проверки.
- Этот файл, `docs/sprint26-plan.md`, `docs/sprint26-progress.md`, `docs/blocks/sprint26.md`, `docs/reports/sprint26/baseline.json`.

Изменены для спринта: `main.py`, `alembic/env.py`, `app/models/models.py`, `app/db/database.py`, `app/security/jwt.py`, `app/services/payments.py`, `driver_eligibility.py`, `dispatch_admission.py`, `dispatch_service.py`, `pickup_points.py`, `relevance.py`; API `payments/cart/pickup_points/equipment/water/sprint19`; schemas `order/quarry/equipment/sprint19`; frontend `main/LoginScreen/CartScreen/CommerceMenu/OrderPaymentsPanel`; `tests/test_release_migration_heads.py`.

**Чужие исходные dirty tracked docs**: `docs/README.md`, `docs/blocks/logist-drivers.md`, `docs/blocks/refunds.md`. В README дополнительно добавлена наша ссылка на sprint26; не stage целый mixed файл. Есть многочисленные исходные untracked audit/screenshots/scripts, не удалять/не включать автоматически. Исходный список/контрольные хеши сохранены в [baseline](reports/sprint26/baseline.json). Прочие неизвестные изменения сначала идентифицировать через diff.

## 6. Что реально опубликовано на тесте

Проверено read-only 2026-10-30 03:37 UTC:

| Объект | Факт |
|---|---|
| Test source HEAD | `907182aebdace81c270d0757ad26381f5ccf941b` + dirty S26 |
| Test runtime HEAD | `1fc821c28c8ad4ac7d5e446bd4f00fce76716981` |
| backend_test image | `sha256:ea015813686f39c3188af4a1569ac1f97de4748abdb94426ba61662556552d83` |
| backend_test start | `2026-10-22T01:17:26.993106151Z`, running |
| Runtime test DB revision | `release_317_merge_heads` |
| Runtime S26 settings table | **отсутствует** |
| S26 возможности в опубликованном backend | **не установлены/не включены** |

Новая миграция применялась **только на disposable QA DB**, не на runtime. Новый UI не опубликован. Наличие исходников не считать наличием функций на сайте.

Test web: https://test.darmavoz.ru/app — пока старый выпуск. Test APK: https://test.darmavoz.ru/static/darmavoz-test.apk — пока старый артефакт, **не артефакт Спринта 26**. Новый SHA/hash/Action run вписать только после фактической доставки.

QA infra: временные контейнеры `s26_qa_postgres` (PostgreSQL 16) и `s26_qa_redis` (Redis 7) во внутренней docker-сети, без host ports. `/tmp/s26-qa-run.py` запускает текущий source в отдельном контейнере на backend image с fake provider, отключёнными real SMS/FCM/LLM. Pytest создаёт/удаляет отдельную БД `darmavoz_test_db_<random>`. **Не подменять URL runtime DB.** Скрипты /tmp — удобство текущей ноды, не постоянный единственный источник процедуры; перед продолжением проверить их и безопасные overrides. Значения секретов не печатать.

## 7. Выполненные проверки, отчёты, известные ошибки

- Изолированный fresh migration `upgrade head` выполнен. Fresh DB в pytest создавалась с актуальным frozen DDL. Полную цепочку downgrade/re-upgrade нужно отдельно зафиксировать.
- `pytest -q tests/test_sprint26_subscriptions.py tests/test_sprint26_chat_journey.py --disable-warnings --maxfail=3 --tb=short`: **23 passed, 4 warnings**, 15.13s. Это результат промежуточного снимка, более поздние resource/transition/frontend/refund-decision изменения им ещё не покрыты.
- Расширенная группа с `test_release_migration_heads.py`, `test_sprint18_relevance.py`, `test_sprint23_pricing.py`: **32 passed, 1 failed**, 26.54s. Failure: `test_public_point_disappears_after_expiry_and_returns_after_extension` на assert о видимости map.
- Этот же failure **воспроизведён на чистом исходном HEAD 907182ae**, отдельный read-only baseline worktree `/tmp/s26-baseline` и отдельная disposable DB: 1 failed, 4 warnings. Следовательно, это исходное рассогласование fixture/старой map логики, а не доказанная регрессия S26. Не скрывать failure и не помечать весь backend зелёным. Уточнить актуальную проверку CRM/city/visibility и добавить новые тесты S26.
- Первоначальный расширенный запуск указал несуществующий `tests/test_dispatch_admission.py`; **это не выполненная проверка**. Реальные файлы: `test_dispatch_flow.py`, `test_dispatch_volume_matching.py`; включить их в последующие группы.
- `npm run lint` (tsc) проходил на промежуточном снимке новых subscription/chat экранов. После поздней journey/direct UI интеграции повторить, затем build.
- Python compileall выполнялся до последней части перехода/dispatch/finance; повторить.
- Browser, Playwright, visual screenshots, live API/test shop E2E и physical APK/PUSH **не выполнены**. Контрольных S26 скриншотов пока **нет**.

Отчёты: [исходный baseline](reports/sprint26/baseline.json), [рабочая история](sprint26-progress.md), [согласованный план](sprint26-plan.md), [документ блока](blocks/sprint26.md). Для новых проверок сохранять безопасные отчёты в `docs/reports/sprint26/`, без контактов/секретов/сырых provider bodies.

## 8. Нерешённые вопросы и риски

Коммерческие вопросы до production (тестовую разработку не блокируют): утверждение всех тарифов, equipment сетки и carrier цены; условия полного/частичного refund и решения по сроку доступа; receipt/VAT/legal/offer/privacy формулировки; спорные legacy owners/номера; retention антиабуза; будущая магазинная политика/версия релиза. Не выдавать draft за утверждение.

Технические незавершённости: см. чек-лист выше. Особое внимание — гонкам платежей/webhook до записи correlation, внешним refund, manual/direct API обходам, contact leaks в nested/raw полях, сохранению срока при смене категории/машины, accepted рейсам после expiry, owner notification payload/time/link, retention/late success и полной серверной инструментализации. Сейчас нельзя считать эти сценарии подтверждёнными.

Физическое устройство не проверялось; никакой записи no_device не считать успешным PUSH/телефонным тестом. Уведомления реальным пользователям не отправлять. Пробные данные test shop и QA получатели создаются отдельно.

## 9. Продолжить отсюда

**Следующая конкретная подзадача:** проверить последние изменения journey/provider error/recovery, notification navigation и chat scroll-to-latest; повторить targeted backend и Playwright, затем зафиксировать первый checkpoint коммит с этим документом (без push до проверки automation). Следом выполнить оставшиеся UI/analytics/migration проверки, paid-water backup/cleanup/reparse и тестовую доставку. Все release steps ниже сохраняются; ничего из runtime test/production ещё не обновлялось.

Далее последовательно, не ожидая нового разрешения:

1. Запустить `npm run lint` и Python compileall на текущем снимке. Проверить фактический git diff и не потерять уже написанное.
2. Тесты provider webhook/restart/23h window/late success/external refund и admin access-decision; transition preview/apply идемпотентность на isolated DB. Проверить связь платежа с journey при гонке, неуспех/cancel/renew/expiry и уведомления.
3. Довести admin UI подписок/тарифов/grants/споров/refunds/settings и admin journeys/chronology/filters/aggregates/owner alerts; связать URL `/admin/journeys` из уведомления с экраном App. Добавить client received/review UI в существующую карточку.
4. Завершить frontend gating всех ролей/карт (в т.ч. water_septic_partner menu), оплаты direct заказов и auth/order/subscription analytics/offline replay. Изучать текущие экраны перед правками.
5. Paid-water DB guard/schema/UI, backup/dry-run/зависимости/test cleanup и seller reparse/staging. Не делать cleanup прежде backup и review списка.
6. Полный набор обязательных автоматических проверок, изолированные migration round trips, frontend build, Playwright и визуальные экраны всех размеров/поворотов. Сохранять скриншоты и исправлять дефекты.
7. Подготовить test transition/feature config/test-only plans, commit только свои изменения (включая актуальный `SPRINT_26.md`), проверить workflows/remote, push develop с ноды. Дождаться test CI, проверить фактический backend image/runtime/web/API/APK SHA/hash. Если CI не доставил, выполнить только test deployment по инструкции ноды с последовательными миграциями, без гонки entrypoint.
8. Выполнить live test E2E и QA уведомления, сравнить production/.env baseline, подготовить физический чек-лист при отсутствии устройства. Финальный отчёт: этапы/остаток, ссылки web/APK, SHA/миграции, проверки/скриншоты, неподтверждённые сценарии, ручная приёмка, подтверждение production unchanged.

Команда адресной проверки (на ноде, после проверки QA runner): `python3 /tmp/s26-qa-run.py "pytest -q tests/test_sprint26_subscriptions.py tests/test_sprint26_chat_journey.py --disable-warnings --tb=short"`. Она не заменяет весь обязательный набор.

### Промежуточная запись после resource tests
2026-10-30: 4 isolated resource tests прошли (7.83s), выходной WaterPointOut redaction исправлен. Admin subscriptions UI/API дописаны, но не проверены браузером. Текущий lint запущен; результат ещё не вписан. Commit/deploy/runtime без изменений.

### Промежуточная запись после admin UI и water guard
2026-10-30: написаны `AdminSubscriptionsScreen.tsx`, `AdminJourneysScreen.tsx`, `OrderReviewPanel.tsx`, подключены menu/URL `/admin/journeys`/карточка клиента. Это **реализовано без браузерной проверки**, не готовые к приёмке интерфейсы. TypeScript проходил до последней части серверных событий/воды; повторяется.

Сервер: добавлены admin account search/vehicle history, явное решение по выполненному subscription refund, transition preview/apply; аналитика переходов этапов; order status markers, сверка поздней привязки payment attempt и expiry audit. Эти новые части ещё требуют отдельных тестов.

Вода: в migration добавлен feature-conditional DB trigger (free запрещён; unknown допускается только как неактивный внутренний staging). Убраны free creation switches в partner/admin формах и free filter на карте. Parser water query направлен на коммерческих продавцов, неизвестная цена не заполняется автоматически. Написан `scripts/sprint26_water_cleanup.py`: test-only guard, preview SHA, private verified compressed backup до удаления, проверка FK, metadata dependencies; storage objects сохраняются. На runtime script **не запускался**, backup/import/cleanup ещё не выполнены. При apply обеспечить host bind mount для backup, не оставить архив только в ephemeral container.

Последняя группа: `test_sprint26_subscriptions.py`, `test_sprint26_chat_journey.py`, `test_sprint26_resource_gates.py`, `test_release_migration_heads.py`, `test_sprint22_api.py`: **33 passed, 4 warnings, 23.61s**. В этой группе проверен migration downgrade/re-upgrade + city/legacy API. Первая попытка выявила ошибку multi-statement op.execute для asyncpg; function/trigger разделены, повторный запуск прошёл. Это не полный backend набор.

Provider recovery/transition tests написаны в `tests/test_sprint26_billing_recovery.py`, выполнение запущено; результат записать после получения. Source HEAD/runtime/production пока без изменений, commit/push/deploy нет.

### Промежуточная запись — provider recovery / isolated browser setup

- `test_sprint26_billing_recovery.py`: **5 passed, 4 warnings, 6.20s**. Проверены retry с прежним idempotency key после смены DB session, запрет повторного POST после 23h, повтор webhook, external refund import + отдельное keep decision/replay/conflict, late binding payment journey, idempotent перенос исходных дат/ownerless resource scope.
- Дописаны server order-status events, payment failure/cancel reconciliation и expiry audit; admin journey transitions counts, frontend receipt/review; UI water capability и public maps учитывают can_order. Wholesale board добавлен в subscription gate, legacy test уточнён для режима feature-off. Последние изменения проходят очередную проверку.
- Water DB trigger был проверен fresh migration + round trip в группе 33 passed; API/DB dedicated paid-water tests ещё нужны. Form changes и parser query не считаются проверенным cleanup/import.
- Поднят **отдельный изолированный QA** backend `s26_qa_backend` на `127.0.0.1:18026` (DB s26qa, fake provider, real SMS/FCM отключены), Vite на `127.0.0.1:18260` с принудительным относительным API/proxy только QA. Это **не опубликованный test.darmavoz.ru**, runtime test не менялся.
- QA фикстуры/авторизация находятся приватно вне git, не копировать их в документы. Browser runner `/tmp/s26-browser-smoke.cjs` запускает проверки новых экранов; скриншоты пишет в `docs/reports/sprint26/screenshots/`. До успешного результата/визуального просмотра не считать проверенными.
- Запущена CI-equivalent группа из актуального `deploy-test.yml` + 4 файла S26, вывод в `docs/reports/sprint26/backend-ci.log`; результат после завершения проверить, не объявлять заранее.
- Текущая следующая подзадача: получить результаты browser smoke / CI-equivalent backend / lint, исправить ошибки; затем полноценный Playwright/visual всех размеров и оплачиваемая вода/API tests. Все оставшиеся release/cleanup/live test/APK шаги остаются обязательными.

### Промежуточная запись — CI и visual, не release

- CI-equivalent backend + новые S26 tests: **250 passed, 13 warnings, 149.62s**; безопасный лог [backend-ci.log](reports/sprint26/backend-ci.log). Позднейшая правка map manual/moderation exclusions требует повторного resource test.
- Browser smoke изолированного QA: **ok, JS errors []**; 3 первоначальных скриншота просмотрены. Снимки пока промежуточные, часть состояния loading; не считать полным visual sign-off.
- Новый opt-in Playwright `frontend/tests/e2e/sprint26-isolated.spec.ts`: первая попытка 2 passed, 1 timeout (chat), 1 not run. Причина: тест проверял наличие trial button до окончания загрузки и не активировал доступ. Добавлено ожидание загруженной категории; повтор запущен. Admin layout checks уже прошли 360/390/768/1024/1440/844 landscape без горизонтального переполнения. Supplier/chat/client matrix пока не подтверждён.
- Dedicated water/admin + resource группа: 7 passed и 1 неверное ожидание 200 вместо фактического 201 create; expectation исправлено, повтор нужен. API и raw DB guard, staging unknown, pure client overview/review/RBAC/manual hidden scenarios уже присутствуют в `test_sprint26_water_and_admin.py`.
- Добавлены текущие новые файлы: `AdminSubscriptionsScreen.tsx`, `AdminJourneysScreen.tsx`, `OrderReviewPanel.tsx`, `tests/test_sprint26_billing_recovery.py`, `tests/test_sprint26_water_and_admin.py`, `scripts/sprint26_water_cleanup.py`, Playwright spec. Документировать их в следующих checkpoint commits.
- `npm run lint && npm run build` запущен, build лог `reports/sprint26/frontend-build.log`; итог проверить перед отметкой «проверено».
- Source остаётся dirty поверх 907182ae; commit/push/deploy S26 ещё нет. Test runtime не обновлялся, production не менялся.

### Промежуточная запись — проверка интерфейсов продолжается

- Последняя dedicated water/admin + resource группа: **8 passed, 5 warnings, 25.49s**. Проверены free API/DB rejection, unknown staging guard, admin search/RBAC/draft-price/null, private cache headers, pure client subscriptions overview/один отзыв/owner boundaries, manual hidden despite active trial.
- `npm run lint` и `npm run build`: **успешно**. Лог [frontend-build.log](reports/sprint26/frontend-build.log). Версию/build не повышали.
- Playwright повтор: **3 passed, 1 failed**. Подписки всех 4 профессиональных ролей/реальная trial активация, chat send/offline draft recovery/pin/delete и admin matrix прошли. Client review test пропускал форму до завершения async received request; добавлено ожидание серверного результата и видимого rating state, повтор запущен. Поскольку тест меняет QA данные, проверки повторов уточняются, не считать устаревшие 3/4 полным sign-off.
- Дополнительно исправлено исключение вручную скрытых/архивных/заблокированных точек из public map при S26 и marker can_order с учётом полного admission predicate. Этот вариант покрыт последней группой 8 passed.
- Чужие docs сохранены, commit/push/deploy всё ещё не выполнялись. Production/.env/runtime test не менялись.

### Последний рабочий checkpoint до commit

- Isolated Playwright: **4 passed, 35.9s**, [playwright-isolated.log](reports/sprint26/playwright-isolated.log). Все целевые ширины + альбомный 844×390; проверка overflow автоматическая. Скриншоты в [screenshots/](reports/sprint26/screenshots/). Просмотрены admin mobile/desktop form, client review 390, supplier subscription 390, long-word chat 360.
- Visual выявил отсутствие перехода чата к новым сообщениям; добавлены scroll-to-latest при открытии/отправке и indicator при чтении истории. После этой правки требуется повторный браузерный проход.
- `test_sprint26_observability.py` + chat/journey: **7 passed, 4 warnings, 14.24s**. Anonymous failed login реально прошёл middleware, контакт зашифрован/маскирован; одно owner inbox/outbox событие при двух maintenance; SMTP failure без кода; успех auth не регрессирует от позднего fail; recreated vehicle сохраняет исходный trial deadline.
- Service-worker navigation tests: **4 passed** (synthetic, не real PUSH). Добавлены безопасные deep links journey session/chat; App/notificationNavigation/Firebase worker обновлены. Real device не подключался.
- Последняя новая работа без проверки: provider-unavailable отдельный incident при сохранении payment pending, восстановление/повторы инцидента, cancellation incident; whitelist значений client telemetry; retention incidents; notification recipient/time/masked-contact/session link. Эти изменения включить в следующий тестовый запуск.
- Новые файлы `tests/test_sprint26_observability.py` и ранее перечисленные входят в S26; чужие исходные docs/untracked по-прежнему не stage целиком. Git/source/runtime остаются как в разделе 5–6; commit/push/deploy не было.

### Checkpoint перед первым кодовым commit (продолжаем полный объём)

Remote fetch выполнен: origin/develop и source по-прежнему 907182ae, чужих новых commit не обнаружено. Production/main не изменялись. Готовится локальный checkpoint; **push пока не выполняется**, автоматизация не запускается до проверки полноты выпуска.

Поздние доработки:
- GET с проверенным JWT связывает текущую session с аккаунтом, не продлевая незавершённые attempts. Offline batch сам не угадывает владельца по текущему токену.
- OrderEvent и EventLog получают один event UUID; однократный catch-up статусов устраняет гонку до связывания creation attempt. Новое поле `journey_attempts.order_synced` в ещё не опубликованной frozen migration.
- Каждый checkout item получает свой attempt, привязанный к session + idempotency key; отдельный parent cart attempt завершается серверным cart_submitted. Не затирать предыдущий order_id несколькими заказами. Добавлен debounced order_form_changed без значений полей и auth_contact_submitted с зашифрованным контактом.
- Chat polling использует message cursor, чтобы не пропускать пачки >50; CTA подписки показывается только для subscription gate, а не для moderator ban. Добавлен scroll-to-latest.
- SMTP background failure фиксируется без OTP/provider exception text; success не регрессирует от позднего fail. Provider-unavailable — отдельная техническая проблема при pending, recovery/повтор проблемы корректно открывают/закрывают incident.

Проверки после части этих изменений: targeted concurrency/чат/observability **30 passed, 4 warnings, 27.89s**; migration round-trip + новые verified-GET/order catch-up tests **8 passed, 4 warnings, 8.83s**; previous 17 targeted tests прошли. Финальные cart parent/child correlation и новые UI cursor изменения ещё повторить. Source/DB test runtime не изменялись.

Следующее: получить текущий lint; проверить multi-order correlation + notification UI/expiry; сохранить checkpoint с этим файлом. Затем остальные сценарии, безопасные water cleanup/reimport, test-shop E2E, deploy/APK и фактическая приёмка остаются обязательными.


### Сохранение первого кодового checkpoint

- Multi-order HTTP test прошёл: два дочерних attempts сохраняют разные order_id, родительская корзина завершается без присвоения одного заказа; повтор с тем же idempotency key связывается с прежним заказом. Первая версия тестовой фикстуры не загружала async relationships (MissingGreenlet); исправлена загрузка через существующий get_order_by_id. Это была ошибка фикстуры, business endpoint не менялся.
- TypeScript (`npm run lint`) и frontend build после последних UI/telemetry изменений прошли. Фактический test runtime ещё старый.
- Новые backend tests включены в **тестовый** workflow deploy-test. В тестовом Android workflow удалён автоматический version:sync: версии остаются исходными. Добавлены immutable APK с commit в имени и JSON manifest с SHA256. Production workflows не изменялись.
- Следующий шаг: checkpoint commit (без push), затем перезапуск disposable QA на текущем коде, расширенный браузерный проход и весь CI набор. Сохранённые чужие docs не включать.

Кодовый checkpoint сохранён: `6a7b95f1b4b0110369591324b20912a8a28b330e` (develop, только на ноде; ещё не pushed).


### Checkpoint после расширенного backend CI

- Полный актуальный backend набор тестового workflow (включая все 6 новых S26 файлов): **264 passed, 14 warnings, 332.68s**. Лог `reports/sprint26/backend-ci.log` на диске (логи исключены gitignore; итог продублирован здесь).
- Isolated browser после увеличения ожидания реального API с 5 до 15 секунд: первые **5 сценариев прошли** (admin matrix, 4 роли/trial, chat/offline/moderation, receipt/review, anonymous offline + masked/revealed audited contact). Шестой moderation/expiry ещё выполняется. Изменение таймаута относится к нагрузочному QA стенду, не скрывает провал бизнес-проверки.
- Первый regression browser запуск остановлен после выявления отсутствующего Vite ключа карты на локальном QA сервере. На отдельном Vite 18261 с фиктивным ключом для мокированного SDK перезапущен весь набор 172 сценариев; результаты ещё собираются. Это не проверка реального 2GIS.
- Test deploy workflow больше не меняет даже symlink `.env`; только проверяет наличие существующего runtime файла. Проверено: текущий test runtime `.env` уже ссылается на source `.env`, hash соответствует baseline, тестовый магазин/ключ активны. Секреты не выводились.
- UI подписок исправлен для повторной покупки того же тарифа: idempotency key сохраняется при неопределённом результате, после terminal результата допускается новая покупка. Требуется адресная проверка.
- Water cleanup дополняется isolated тестами stale preview/backup/dependencies; пока на runtime не запускался. Добавлен фактический раздел о прямых расчётах в TermsPage без выдуманных условий возвратов подписок; юридические коммерческие решения по подпискам остаются открытыми.

Продолжить: получить результаты текущих water/browser runs, проверить повторную покупку, paid-water формы и remaining gates; затем безопасный test backup/commit/push/deploy, переход данных, test-shop E2E и APK. Production по-прежнему не менялся.


### Тестовые данные воды и завершённые проверки перед выпуском

- **На runtime test выполнено удаление 6 бесплатных water_points и 5 media metadata**. До удаления сделаны полный private pg_dump и отдельный проверенный JSON.gz snapshot, preview SHA совпал. S3 объекты сохранены для восстановления. Production не затрагивался. Безопасные отчёты: [water-preview.json](reports/sprint26/water-preview.json), [water-cleanup.json](reports/sprint26/water-cleanup.json), [test-backup.json](reports/sprint26/test-backup.json). Перепарсинг продавцов ещё нужен.
- На приватном клоне `s26_migration_test` выполнен upgrade → перенос → downgrade → upgrade. Исходные hashes/counts orders/items/users/vehicles/water/media/payments/events/refunds совпали; 127 заказов, 9 платежей, 2 возврата сохранены. Перенос 34 ресурсов: 17 сохранённых grants, 17 без подтверждённого срока требуют review; повтор переносит 0 grants. 68 исторических тестовых машин имеют невалидные госномера — не придумывать им trial. Скрипт `scripts/sprint26_migration_smoke.py` жёстко ограничен disposable clone. Первый запуск скрипта обнаружил использование pool в разных asyncio loops; скрипт исправлен на один loop, итоговый проход успешен.
- Mixed fleet/driver↔carrier исправлены: общая исходная граница CategoryAccess и каждой новой машины, истёкший trial не перезапускается через carrier. **23 access tests passed**. **6 water/admin/cleanup tests passed**.
- Из browser matrix первые 5 isolated тестов прошли; moderation/expiry и paid-water form отдельно **2 passed (53.7s)**; повторная покупка/неопределённый запрос **1 passed (13.8s)**. Просмотрены screenshots chat moderation/expiry, paid water 360, admin anonymous timeline 390. В форме выявлен старый subtitle про бесплатную воду — заменён на платных поставщиков. Неизвестные imported точки в admin помечаются требующими проверки.
- Полный browser regression: 168 passed / 4 failures. Один fixture использовал бесплатную воду, обновлён на платную согласно S26; client setup учитывает уже открытый клиентский кабинет. На стабильной build preview повтор всех этих случаев и desktop соседей: **6 passed (14.8s)**. Первые тесты выполнялись с Vite/HMR и параллельной нагрузкой; окончательный CI нужен на стабильной сборке.
- Старый `test_dispatch_flow.py` вне CI выявил устаревшие city/coordinates fixtures и Redis loop: 7 failed / 8 passed; первый failure **воспроизведён на неизменённом HEAD 907182ae**. Не исправлять приложение под старые неверные ожидания. Для бизнес-правил S26 добавлен новый current-fixture тест передачи/120 секунд/manual/accept; его довести до green перед выпуском.
- Улучшен доступ после expiry: водитель видит явное предложение подписки, ранее принятый рейс доступен; существующие публичные карты материалов/воды/септиков доступны из профессионального профиля независимо от доступа. Новые `DriverSubscriptionNotice.tsx`, `PublicCatalogMap.tsx`; требуется финальная visual/API проверка.
- Диагностические business codes проходят через существующий error response совместимо с его human message/support reference; journey получает точную причину через фактически установленный handler. Изменения ещё проходят тесты.

Следующее: targeted dispatch/errors/lint, checkpoint+push develop с проверкой только test workflows. Дождаться Actions, затем фактический test deploy/schema/flags/transition, reparse sellers/test-shop E2E/Android artifact. Все последние исходники пока dirty сверх `6a7b95f1`, новый release на сайте ещё не опубликован.


### Готовность к первому push Спринта 26

- Targeted dispatch/resource/observability: **13 passed, 4 warnings, 21.92s**. Проверены отказ/таймаут и передача второму доступному водителю с сохранением 120 секунд; водитель без подписки исключён из очереди, manual и direct accept возвращают запрет; ранее назначенная доставка завершается после expiry. Старые неактуальные fixtures не использованы как доказательство.
- Финальный TypeScript и frontend build после notice/public-map изменений — успешно; YAML + bash syntax обоих тестовых workflows проверены. Версия 3.3.3 / build 391 не изменены.
- Git fetch и push dry-run успешны. Проверены **и source develop, и origin/main** workflows: production auto deploy только от `Build Android APK` на main; test APK и test deploy на develop. По GitHub текущий default branch — develop (локальный origin/HEAD может быть устаревшим). Production workflow руками не запускать. Исторические production runs на develop существуют, но текущие триггеры от test APK его не запускают.
- Тестовый 2GIS Places работает. Из двух коммерческих запросов получено 52 уникальных подтверждённых по рубрикам поставщика; бесплатные источники исключены; preview сохранён приватно. Применение импорта выполняется; результат проверить. Неизвестные цены остаются inactive/auto_added/pending_moderation, не публикуются и не превращаются в zero.

Первый push подготовлен, ещё не выполнен. После push записать точный SHA и Action runs, дождаться их фактического успеха. Новые S26 flags пока выключены (runtime старый), несмотря на уже выполненную очистку free water test data.
