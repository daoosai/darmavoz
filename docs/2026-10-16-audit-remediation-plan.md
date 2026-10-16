# План устранения 10 замечаний E2E-аудита

Статус: утверждён Tech Lead и PO; реализация описана в 2026-10-16-security-bugfix.md.
Контур: develop, /opt/darmavoz_test, test.darmavoz.ru.
Источник: 2026-10-16-general-e2e-security-audit.md.
Код, зависимости и конфигурация не менялись; commit/push/deploy не выполнялись.

## Critical

1. SEC-01: зафиксировать @capacitor/core, android, ios, cli на 8.4.3. В frontend: npm install --save-exact @capacitor/core@8.4.3 @capacitor/android@8.4.3 @capacitor/ios@8.4.3 @capacitor/cli@8.4.3; npm run lint; npm run build; npx cap sync android; npm audit --json. iOS sync/build — в macOS-контуре. Проверить существующие postinstall patches, совместимость плагинов, native build и запрет navigation внутреннего interceptor. Проверить состав Play APK/AAB; выпуск исправления в Play — отдельный релиз. Номера приложения/сборки не повышать без прямого поручения.
2. SEC-02: в docker-compose.test.yml заменить host bindings на 127.0.0.1:5433:5432, 127.0.0.1:6380:6379, 127.0.0.1:8001:8000, 127.0.0.1:9002:9000, 127.0.0.1:9003:9001. Сохранить Docker network и Caddy backend_test:8000. Сверить MinIO proxy и host-скрипты; пересоздать только затронутые test-сервисы без удаления volumes. Проверить снаружи IPv4/IPv6, из контейнера Caddy, localhost и HTTPS upload flow. При необходимости сетевого ограничения использовать Docker-aware firewall, не полагаться на UFW INPUT.

## Medium

3. BUG-01: отдельная FastAPI-зависимость поставщика для create/edit/submit оптовых заявок; сохранить read-only board_user для ленты и admin-only moderation. Проверить также ранее созданные driver drafts. Тесты driver POST/PUT/submit ->403, supplier owner success, остальные роли denied. Реальный маршрут /api/v1/wholesale-requests.
4. SEC-03: атомарные Redis-лимиты: 5 неудач за 15 минут на нормализованный аккаунт+IP, 30 запросов в минуту на IP до bcrypt; агрегированный контроль аккаунта с временной задержкой без бессрочного блокирования. 429 + Retry-After, одинаковые ответы для неизвестного логина. Учитывать aliases телефона, доверенную цепочку прокси, гонки и несколько workers. При отказе Redis защищённый вход ->503, без обхода лимита. Пороги через settings, без редактирования серверных .env.
5. SEC-04: в disposable Python 3.11 environment подготовить совместимый набор обновлений requirements.txt + lock/constraints. Кандидаты из реестра: FastAPI 0.143.2, Starlette 1.8.0, Pydantic 2.14.1, pydantic-settings 2.16.0, python-multipart 0.0.32, python-dotenv 1.2.4. Это кандидаты до resolver/check/tests/advisory, не подтверждённая совместимость. Предпочесть миграцию python-jose -> PyJWT[crypto] 2.15.1 с сохранением claims/TTL/algorithm allowlist/auth_version и старыми JWT. Проверить удаление ненужной ecdsa зависимости. Обновить build pip/setuptools; разобрать все npm findings по цепочкам, без audit fix --force. Проверить pip check, pip-audit, auth/payment/refund/backend тесты и фактический image.
6. BUG-02: сохранить name max_length=255, short_name max_length=100; при отсутствии short_name формировать короткое имя до 100 символов, полный name сохранять. Одинаковые create/update правила, maxLength UI. Тесты 100/101/255/256, short_name 100/101, whitespace.
7. BUG-03: Pydantic strict float с ge/le, allow_inf_nan=False; убрать сравнения непроверенного объекта в before validators. Числовые строки/boolean/NaN/Infinity/неверный диапазон ->422, нормальные JSON числа ->success, optional null сохраняется. Сверить create/update и фронтовое преобразование координат, не ограничиваться изменением HTTP-кода общей ошибки.

## Minor

8. UI-01: исправить intrinsic sizing в OperatorCityBar/Field: w-full/min-w-0 на flex ancestors, w-0 min-w-0 flex-1 на select, shrink-0 на иконке, max-w-full/ограничение доступной ширины. overflow-hidden — только на локальной обёртке при необходимости, без скрытия overflow страницы целиком. Приёмка document.scrollWidth<=innerWidth на 320/390/768/1440, длинных названиях и открытых модалках.
9. UI-02: найти шаблоны в Git/документации; восстановить подтверждённые тексты, иначе согласовать предлагаемый набор (неполные данные, контакт, адреса, условия). Добавить пресеты в модалку, оставить редактируемую причину и обязательность непустого текста, сброс при смене заявки. UI click preset -> saved reason -> supplier sees reason. Утрата шаблонов аудитом ещё не доказана.
10. UI-03: aria-label="Добавить объявление спецтехники" на button, при необходимости title, декоративному SVG aria-hidden; type=button. Проверить getByRole(button,{name:...}), Tab/Enter/Space и доступное имя.

## Доставка после утверждения и реализации

Отдельные тематические коммиты с ноды; соответствующие backend/frontend/security проверки. Push только develop, дождаться CI, проверить runtime commit/image и опубликованный test UI. Обновить docs/blocks и отчёт со статусом каждого пункта. Сохранить чужие изменения. Production, Google Play публикация и повышение версии приложения не входят в автоматическую тестовую доставку.

Каждый пункт закрывать по фактическому критерию приёмки; устранение риска исходников не означает устранение риска в уже опубликованном native APK. Откат — предыдущие проверенные image/static и compose при сохранении данных, без возврата публичного доступа к служебным портам.

Источники версий:
- https://github.com/ionic-team/capacitor/security/advisories/GHSA-rvm3-566m-v7fv
- https://pypi.org/pypi/fastapi/json
- https://pypi.org/pypi/starlette/json
- https://pypi.org/pypi/PyJWT/json
