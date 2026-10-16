# Security & Bugfix — выполнение утверждённого плана
Контур develop, /opt/darmavoz_test, test.darmavoz.ru. Production не меняется.
Версии приложения/сборки и серверные .env не меняются.
Базовая ревизия e58697c1. План: 2026-10-16-audit-remediation-plan.md.
Статус: все 10 пунктов реализованы и приняты в тестовом контуре.
Фактически доставленный код и image revision: 02b662c5b4259cb833efb5c6496e705d3854ce9f.
Контрольное пересоздание backend: 16.10.2026 08:50 UTC. Финальные результаты ниже.


## Critical
- SEC-01: Capacitor core/android/ios/cli фиксируются на 8.4.3; проверка native patches, lint/build/sync и Android CI.
- SEC-02: пять host ports тестового контура привязаны только к 127.0.0.1.
  Docker-сеть и внутренние адреса Caddy/DB/Redis/MinIO сохранены.
Финальные проверки и фактическая доставка приведены в разделе приёмки ниже.

## Medium — реализация
- BUG-01: отдельная FastAPI publishing_user dependency запрещает создание,
  редактирование и submit оптовых заявок всем, кроме supplier. Права чтения
  водителя и модерации администратора сохранены.
- SEC-03: атомарный Redis limiter перед bcrypt: IP 30/60s, пара account/IP
  5/900s, короткая общая задержка после 10 ошибок; 429 + Retry-After.
  При отказе Redis вход закрывается с 503. Ключи HMAC, доверие XFF только
  именованному Caddy. Конкурентность и подмена XFF покрыты тестами.
- SEC-04: python-jose заменён на PyJWT; обновлены FastAPI/Starlette/Pydantic,
  multipart, dotenv, cryptography и связанные зависимости. Полный набор
  закреплён requirements.lock. Точные версии — docs/blocks/security-dependencies.md.
- BUG-02: name до 255 символов, short_name до 100; автоматически вычисляемое
  short_name обрезается до 100 при create/update supplier и admin API.
- BUG-03: координаты принимают только JSON-числа, без bool/string/NaN/Inf,
  с диапазонами lat +/-90, lon +/-180; ошибочные входы возвращают 422.


### Промежуточные проверки
- Порты 5433/6380/8001/9002/9003 после пересоздания test-сервисов недоступны
  с внешнего хоста; Caddy -> backend_test:8000 /health отвечает online.
- lint/build/sync Android после Capacitor 8.4.3 прошли; iOS patch version guard
  обновлён; test APK workflow больше не переустанавливает unpinned Android.
- 94 backend tests security/auth/driver OTP/wholesale/refunds passed в отдельных
  Postgres/Redis. Legacy JOSE JWT и auth_version проверены.
- pip check: pass. pip-audit resolved Python 3.11 constraints: 0 advisories.
- .dockerignore дополнен исключением серверных .env из image build context.
Это промежуточный результат; итоговая регрессия и доставка приведены ниже.

## Minor — реализация
- OperatorCityBar/Field: ограничены flex intrinsic widths (w-full/min-w-0,
  select w-0/flex-1), без overflow-hidden на документе.
- Общая ReasonModal принимает presets; обе точки оптовой модерации используют
  четыре утверждённых шаблона с редактируемым текстом и сбросом между заявками.
- Уточнение UI-03 исходного аудита: в текущем исходнике уже существовало
  общее aria-label="Добавить объявление". Оно конкретизировано до
  "Добавить объявление спецтехники"; добавлены title и aria-hidden на SVG.
  Это усиление/регрессия доступности, а не подтверждённое отсутствие aria-label.
- 15 новых браузерных security/UI тестов прошли (layout 12 + presets 1 +
  keyboard accessibility 2). Общая UI-регрессия включена в финальный CI.
- flake8 обнаружил в equipment.py старый недостижимый дубликат после return
  с неопределёнными именами; удалён только этот недостижимый блок.
- Старые тесты уточнены под supplier-only публикацию и реальную пакетную
  обработку outbox (30 записей), не ослабляя проверку доставки нужной причины.

### Доставка: очистка диска
Первая доставка остановилась из-за заполненного диска при распаковке образа.
Удалены временный node_modules предыдущей установки и тест генератора ресурсов,
очищен неиспользуемый Docker build cache (4.932 GB). Освободилось около 4.7 GiB.
Из backend build context исключены APK/AAB, дубли backend/static, отчёты и native-проекты.
Базы, пользовательские файлы, .env и production не изменялись.


### Дополнительная очистка сервера по поручению владельца
- У Docker-лога daoos_mcp было 13,373,174,322 байта; последние 64 MiB сохранены
  root-only в /root/maintenance-logs/daoos_mcp-tail-20261016.log, старый лог очищен
  без остановки сервиса.
- Удалены 8 старых завершённых/не запущенных QA/build контейнеров,
  npm download cache, два временных контейнера текущих тестов с их собственными
  anonymous volumes и образ darmavoz-security-validation.
- Через git worktree remove без force удалены 7 чистых устаревших worktree:
  darmavoz_client_map_main, darmavoz_payment_review_main, darmavoz_update_main,
  darmavoz_points_baseline, darmavoz_suburbs_baseline, darmavoz_suburbs_main,
  darmavoz_release_main. Незакоммиченных изменений и ссылок процессов на них
  не было; Git-история остаётся в общем репозитории.
- Источники develop/main, оба runtime, Docker volumes действующих баз,
  MinIO и опубликованные APK сохранены. Свободно около 24 GiB (было 0.5 GiB).
- Ротация лога daoos_mcp требует отдельной настройки его сервиса: выполненная
  очистка разовая, production-сервисы DAOOS не пересоздавались.

### Дополнительная регрессия при приёмке live UI
На реальной статистике на 320px выручка выталкивала декоративную иконку:
scrollWidth 344. Исправлено складыванием содержимого карточки на узких экранах,
min-w-0 и переносом длинного значения без обрезания. В regression fixture
вместо нуля используется 1234567890.25. Все 15 целевых UI-тестов прошли.
На live выполнены 23 API проверки, сохранены legacy JWT всех 7 ролей.
Вход: 200, пять 401, затем 429 с Retry-After=898. Пресет реально отредактирован,
причина сохранена и видна поставщику. Ошибок console/page/network в live UI нет.
Окончательная повторная проверка статистики и доставка прошли; результаты ниже.

### Пограничное окно Redis limiter
При ревью добавленного limiter обнаружено: Redis TTL возвращает 0, когда ключ
ещё существует менее половины секунды. Условия превышения IP/pair теперь
возвращают минимум 1 секунду; блокировка не пропускает запрос в конце окна.
Регрессия с реальным Redis PTTL=400ms + конкурентные слоты + account delay:
3 passed. Проверка выполнялась в отдельном Redis и одноразовом контейнере,
без обращения к рабочей БД. Промежуточный CI UI-дополнения отменён перед
доставкой, чтобы устаревший workflow не перезаписал последний commit.

## Финальная приёмка — 16.10.2026

| Пункт | Проверенный результат |
|---|---|
| SEC-01 Capacitor | core/android/ios/cli 8.4.3; Android APK + signed AAB и iOS Simulator собраны успешно |
| SEC-02 служебные порты | 5 loopback bindings; внешний доступ закрыт; Caddy/DB/Redis/MinIO работают |
| BUG-01 оптовая публикация | supplier-only create/edit/submit; driver/equipment/water POST 403; legacy driver drafts покрыты тестами |
| SEC-03 перебор паролей | Redis Lua, 429/Retry-After, конкурентность, TTL, aliases, XFF, outage 503 проверены |
| SEC-04 зависимости | PyJWT 2.15.1; Python/JS обновлены; pip check: pass; pip-audit и npm audit: 0 известных advisory |
| BUG-02 длинное имя | 100/101/255 символов create/update успешны; 256 ->422; short_name не переполняет БД |
| BUG-03 координаты | JSON string/bool/NaN/Inf/range errors ->422; корректные числа работают |
| UI-01 города/статистика | scrollWidth<=viewport для 320/390/768/1440; проверены большие суммы и загруженные данные |
| UI-02 быстрый отказ | четыре пресета, редактирование, сброс; причина сохранена и видна поставщику |
| UI-03 A11y | конкретное имя кнопки, Enter/Space открывают форму; исходное замечание о полном отсутствии label уточнено |

### Проверки
- Финальный GitHub backend job и полный выбранный E2E-прогон frontend прошли,
  включая npm lint, build, calculator unit tests, auth/OTP/wholesale/refund/
  city isolation/hard delete и остальные регрессии workflow.
- Последняя локальная целевая серия: 15 passed (47.7s). Тест ожидает загруженную
  карточку выручки; fixture содержит 1234567890.25. На малом сервере load/5s
  readiness давали timeout холодного Vite: используются DOMContentLoaded и
  явная готовность city options до 15s. После изменения вся серия прошла.
- flake8: fatal checks E9,F63,F7,F82 по app/tests; полная проверка новых модулей
  login_throttle.py, jwt.py и test_security_audit.py с max-line-length=120.
  Legacy style всего репозитория не переформатировался.
- На реальном test.darmavoz.ru: 23 API проверки, legacy python-jose JWT
  продолжают работать у 7 ролей; новый password login 200.
- Реальный brute force: пять неверных паролей ->401, следующий ->429,
  Retry-After=898. На уже доставленном image проверен последний TTL Redis:
  оба ограничения возвращают 429/Retry-After=1, временные ключи удалены.
- 14 live browser проверок без mock API: 12 viewport/route checks,
  редактируемый отказ, клавиатурная кнопка спецтехники. Console errors,
  page errors и HTTP>=400: пустые списки.
- Дополнительно: предзаполнение своей QA-машины (vehicle_id, QA, 5-10 м³),
  доступность модалки на 390px; HTTPS presign/PUT/public read/confirm/delete
  тестового изображения. Взаимодействие Caddy->backend, backend->DB/Redis/
  MinIO подтверждено реальными запросами.

### Доставка и активация ЮKassa
- Все изменения приложения доставлены из develop в test runtime на 02b662c5.
  После CI выполнено явное:
  cd /opt/darmavoz_test_deploy
  docker compose -f docker-compose.test.yml up -d --no-deps --force-recreate backend_test
- Стабильный контейнер, restartCount=0, startup traceback нет; внешний
  https://test.darmavoz.ru/health ->200/online, внутренний Caddy health ->online.
- ЮKassa: enabled=true, test_mode=false, receipts_enabled=true.
  Применены значения .env, изменённые Tech Lead. Секреты не печатались,
  .env не редактировался, ключи не запекались в новый Docker image.
- После пересоздания снова подтверждены 5 loopback bindings и закрытые
  внешние 5433/6380/8001/9002/9003.
- Финансовые операции/списания/возвраты в реальном провайдере не выполнялись.

### CI
- Deploy/backend/frontend:
  https://github.com/daoosai/darmavoz/actions/runs/38875135882 — success.
- Android APK + signed AAB:
  https://github.com/daoosai/darmavoz/actions/runs/38875135950 — success.
- iOS Simulator / Xcode 26.2:
  https://github.com/daoosai/darmavoz/actions/runs/38875381597 — success.
- Первая доставка 38845346623 не прошла из-за заполненного диска; повторная
  38872945197 прошла. Промежуточная 38874448628 отменена намеренно перед
  финальной ревизией, не доставляла устаревший код.

### Очистка после проверок
Отключены 6 собственных QA users и 2 QA clients, их auth_version увеличен;
1 QA driver и 1 vehicle отключены; 3 точки и 1 оптовая заявка архивированы.
Удалены 16 связанных QA-уведомлений/outbox. Старый QA JWT теперь получает 401.
Тестовое изображение удалено через media API. Реальных заказов и платежей
для этой приёмки не создавалось.
После очистки сервера свободно около 23 GiB, занято 47% вместо 99%.

### Артефакты и ограничения
Артефакты: docs/reports/2026-10-16-security-bugfix — JSON проверок,
CI/run metadata и скриншоты собственных QA-модалок/фильтра; JWT и паролей нет.
Исходные чужие изменения docs/README.md и старые audit artifacts сохранены.
Последующие коммиты ожиданий тестов/документации не меняют приложение и не
требуют пересборки runtime 02b662c5.
Production Дармавоза, main, app version/versionCode 3.1.7/387 не менялись.
Google Play/App Store не публиковались: исправление установленного приложения
потребует отдельного выпуска. iOS Simulator build не заменяет проверку на
физическом устройстве. В backend suite остаются прежние deprecation/OpenAPI
duplicate operation warnings; неожиданных ошибок live UI нет.

### Тематические коммиты приложения
- 70cdb35e fix(security): pin Capacitor 8.4.3 and honor native lockfile
- b8705cb5 fix(security): bind test infrastructure ports to loopback
- 2d35e6f6 build(android): sync native plugin projects after Capacitor update
- 051186b7 fix(security): enforce supplier-only wholesale publishing
- 99ce409e fix(security): migrate JWT to PyJWT and lock audited dependencies
- 68068d9e fix(auth): throttle password login atomically with Redis
- 69b9c343 fix(validation): constrain pickup point names and coordinates
- 1e6e00f0 fix(ui): fit city filters and add editable rejection presets
- 5e485f20 test: verify moderation across queued delivery batches
- 3b7094aa docs: record approved audit remediation and dependency checks
- 7b86d970 build: exclude release artifacts from backend image
- 08483472 fix(ui): wrap populated statistics cards on narrow screens
- 02b662c5 fix(auth): retain login limits until Redis keys fully expire
