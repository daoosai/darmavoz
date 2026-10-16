# Security & Bugfix — выполнение утверждённого плана
Контур develop, /opt/darmavoz_test, test.darmavoz.ru. Production не меняется.
Версии приложения/сборки и серверные .env не меняются.
Базовая ревизия e58697c1. План: 2026-10-16-audit-remediation-plan.md.

## Critical
- SEC-01: Capacitor core/android/ios/cli фиксируются на 8.4.3; проверка native patches, lint/build/sync и Android CI.
- SEC-02: пять host ports тестового контура привязаны только к 127.0.0.1.
  Docker-сеть и внутренние адреса Caddy/DB/Redis/MinIO сохранены.
Проверки и фактическая доставка дополняются по результату, не считаются завершёнными заранее.

## Medium — реализация
- API-01: отдельная FastAPI publishing_user dependency запрещает создание,
  редактирование и submit оптовых заявок всем, кроме supplier. Права чтения
  водителя и модерации администратора сохранены.
- AUTH-01: атомарный Redis limiter перед bcrypt: IP 30/60s, пара account/IP
  5/900s, короткая общая задержка после 10 ошибок; 429 + Retry-After.
  При отказе Redis вход закрывается с 503. Ключи HMAC, доверие XFF только
  именованному Caddy. Конкурентность и подмена XFF покрыты тестами.
- DEP-01: python-jose заменён на PyJWT; обновлены FastAPI/Starlette/Pydantic,
  multipart, dotenv, cryptography и связанные зависимости. Полный набор
  закреплён requirements.lock. Точные версии — docs/blocks/security-dependencies.md.
- VAL-01: name до 255 символов, short_name до 100; автоматически вычисляемое
  short_name обрезается до 100 при create/update supplier и admin API.
- VAL-02: координаты принимают только JSON-числа, без bool/string/NaN/Inf,
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
Финальная регрессия и доставка ещё не завершены.

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
  keyboard accessibility 2). Дальнейшая общая UI-регрессия выполняется.
- flake8 обнаружил в equipment.py старый недостижимый дубликат после return
  с неопределёнными именами; удалён только этот недостижимый блок.
- Старые тесты уточняются под supplier-only публикацию и реальную пакетную
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
Окончательная повторная проверка статистики и доставка этого дополнения ожидаются.

### Пограничное окно Redis limiter
При ревью добавленного limiter обнаружено: Redis TTL возвращает 0, когда ключ
ещё существует менее половины секунды. Условия превышения IP/pair теперь
возвращают минимум 1 секунду; блокировка не пропускает запрос в конце окна.
Регрессия с реальным Redis PTTL=400ms + конкурентные слоты + account delay:
3 passed. Проверка выполнялась в отдельном Redis и одноразовом контейнере,
без обращения к рабочей БД. Промежуточный CI UI-дополнения отменён перед
доставкой, чтобы устаревший workflow не перезаписал последний commit.
