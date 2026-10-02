# AGENTS — Дармавоз: обязательный порядок работы

## Актуальные правила для Codex

Этот раздел — актуальная точка входа. Описание production ниже содержит исторические пути; при расхождении использовать проверенные настройки выбранного контура и актуальные workflows.

- Вся работа с кодом, проверки, коммиты и push выполняются строго на ноде Дармавоза (hostname `foptyvllka`). Копия на хосте агента не является рабочей копией проекта.
- Перед каждой задачей читать этот `AGENTS.md`, `README.md`, профильные документы в `docs/`, актуальные `.github/workflows/`, рабочее дерево и последние коммиты. Выполненное и оставшееся сверять с кодом, отчётами и реально запущенным контуром; наличие описания реализации само по себе не означает успешную проверку.
- Обычные исправления от тестировщика выполняются в тестовом контуре: код `/opt/darmavoz_test`, ветка `develop`, runtime `/opt/darmavoz_test_deploy`, compose `docker-compose.test.yml`, контейнер `backend_test`, сайт `https://test.darmavoz.ru/app`.
- Боевой контур используется только при явном поручении на production: код `/opt/darmavoz`, ветка `main`, runtime `/opt/darmavoz_deploy`, compose `docker-compose.yml`, сайт `https://darmavoz.ru/app`. Не переносить тестовую задачу в main/production автоматически.
- Работать в каталоге исходников. Runtime worktree не редактировать как исходники. Фактические пути проверять через Docker Compose labels; `/opt/darmavoz_deploy_test` и `/opt/darmovoz/test` не являются подтверждёнными путями.
- Просьба исправить ошибку или выполнить задачу включает необходимые проверки, **коммит и push в GitHub с ноды**, доставку в выбранный контур и проверку результата. Тестировщику не требуется отдельно просить «закоммить и запушь». Исключение — прямое указание пользователя не коммитить/не пушить/не деплоить либо задача только на анализ.
- Репозиторий: `https://github.com/daoosai/darmavoz.git`. На 02.10.2026 Git-авторизация с ноды работает: `GIT_TERMINAL_PROMPT=0 git push --dry-run origin HEAD:develop` успешен. `gh` не установлен, для Git он не обязателен. Секреты авторизации не печатать и не включать в коммит.
- Перед коммитом проверить `git status`, diff и актуальные remote refs. Коммитить только изменения задачи, сохранять чужие изменения. Не применять force push, не сбрасывать чужие коммиты. При отказе авторизации или защите ветки сообщить конкретный блокер; не заявлять, что push состоялся.
- После изменения приложения дождаться результата соответствующего GitHub Actions и проверить реально отданный frontend/backend. Тестовый deploy описан в `.github/workflows/deploy-test.yml`; production — в `.github/workflows/deploy.yml`. Push сам по себе не означает завершение.
- Backend собирается в image: restart без пересборки не применяет код. Если CI не доставил изменения, использовать актуальную процедуру выбранного контура на этой ноде: обновить runtime на нужный commit, собрать backend, при наличии миграций выполнить их одним процессом и пересоздать сервис. Проверить commit runtime/image, health и изменённый пользовательский сценарий снаружи. Не запускать миграции одновременно с entrypoint.
- Для UI проверять исправление в браузере выбранного контура, для backend — адресные тесты и реальное поведение API. Документационные изменения не требуют пересборки приложения.
- Документацию тестового проекта вести в `/opt/darmavoz_test/docs/`: отдельные документы по блокам в `docs/blocks/`, оглавление `docs/README.md`. Для затронутого блока описывать назначение, что реализовано и как работает, ключевые файлы/API, проверки и оставшееся. Отчёт задачи дополняет документ блока; не забывать обновлять оба при изменениях.
- После задачи записать краткую передачу в `docs/`: что изменено, контур, проверки и их результат, commit, push, фактический deploy, известные ограничения и оставшаяся работа. В ответе пользователю назвать результат и незавершённые шаги. Не выдавать неподтверждённое за выполненное.
- Серверные `.env` не менять. Версии приложения и номера сборок менять только по прямому указанию пользователя; правила ниже сохраняются.

## Состояние входной документации на 02.10.2026

- Проверен путь запущенного тестового backend: `/opt/darmavoz_test_deploy/docker-compose.test.yml`.
- Последний исходный commit develop перед этой правкой: `03cedc23` (права логиста на управление машинами).
- Документация спринтов: `docs/sprint22.md`, `docs/sprint24.md`, `docs/SPRINT_25_IMPLEMENTATION.md`. Отчёт спринта 25 описывает реализацию; реальный PUSH на Android/iOS требует устройств и настройки FCM.
- Подробное описание ниже было добавлено в рабочее дерево до этой задачи и сохранено. Его ссылки на `/opt/darmavoz` и `react_web` относятся к production/историческому описанию: текущие пути отдачи и статус проверять по workflow и live-конфигурации.

# Правила обновления версии приложения

## ПРАВИЛА ОБНОВЛЕНИЯ ВЕРСИИ ПРИЛОЖЕНИЯ

1. Пользователь (Tech Lead) САМ вручную меняет версию в серверных файлах `.env` в `/opt/darmavoz_deploy` и `/opt/darmavoz_test_deploy`. Кодексу туда лезть ЗАПРЕЩЕНО.
2. СТРОГО ЗАПРЕЩЕНО автоматически повышать версию приложения при коммитах, релизах, хотфиксах и других изменениях.
3. Изменять версии и номера сборок можно ТОЛЬКО при прямом и явном указании пользователя в промпте. Это правило распространяется на `frontend/package.json`, `frontend/package-lock.json`, `frontend/android/app/build.gradle`, `frontend/ios/App/App/Info.plist`, Xcode-проект и другие файлы версий. Не запускай `version:sync` без такого указания.
## Назначение

Этот файл нужен как краткая рабочая документация по проекту Darmavoz на продовой ноде.
Основная рабочая копия проекта находится в:

`/opt/darmavoz`

Домен продового контура:

`https://darmavoz.ru`

## Что это за проект

Darmavoz - сервис заказа и логистики доставки с несколькими ролями:

- `client`
- `driver`
- `logist`
- `manager`
- `admin`

Система покрывает:

- каталог материалов
- варианты доставки по кубатуре
- оформление заказа
- логистский список заказов
- ручное и автоматическое назначение водителей
- профиль водителя и машины
- модерацию водителей и транспорта
- загрузку фото через MinIO/S3
- web-клиент и мобильный/driver UI на базе React frontend

## Технологический стек

### Backend

- Python 3.11
- FastAPI
- SQLAlchemy async
- Pydantic Settings
- PostgreSQL
- Redis
- JWT auth

### Frontend

- React
- TypeScript
- Vite
- Zustand
- есть Capacitor-структура для mobile shell в `frontend/android`

### Infra

- Docker Compose
- MinIO
- Caddy
- внешняя docker-сеть `daoos_kit_default`

## Ключевые каталоги

```text
/opt/darmavoz
├── app/                  # backend код
│   ├── api/              # FastAPI routers
│   ├── core/             # config
│   ├── db/               # engine/session/seed
│   ├── integrations/     # внешние интеграции
│   ├── models/           # ORM модели
│   ├── schemas/          # Pydantic схемы
│   ├── security/         # auth/jwt/password
│   └── services/         # storage, dispatch, redis и т.д.
├── alembic/              # миграции
├── frontend/             # исходники фронтенда
├── react_web/            # статика, которую отдает Caddy
├── static/               # служебная статика, в т.ч. APK
├── scripts/              # утилиты и разовые патчи
├── tests/                # тесты
├── docker-compose.yml    # prod backend + minio
├── docker-compose.local.yml
├── darmavoz.caddy        # репозиторный вариант Caddy-конфига
├── main.py               # вход backend
├── README.md
└── architecture.md
```

## Как устроен backend

Точка входа:

`/opt/darmavoz/main.py`

Backend поднимает:

- FastAPI app
- глобальный `CORSMiddleware`
- startup seed
- dispatch worker

Подключенные роутеры:

- `/api/v1/auth`
- `/api/v1/admin`
- `/api/v1/catalog`
- `/api/v1/clients`
- `/api/v1/drivers`
- `/api/v1/logist`
- `/api/v1/driver`
- `/api/v1/media`
- `/api/v1/orders`
- `/api/v1/system`
- `/api/v1/webhooks`

Сервисные endpoints:

- `GET /`
- `GET /ping`
- `GET /health`
- `GET /docs`

### Основные backend-файлы

- `app/api/auth.py` - логин и регистрация
- `app/api/admin.py` - админка, водители, модерация, управление
- `app/api/drivers.py` - логистский список автопарка и driver-related API
- `app/api/logist_orders.py` - логистские операции по заказам
- `app/api/orders.py` - checkout и заказы
- `app/api/media.py` - presign upload / confirm
- `app/services/storage.py` - MinIO/S3 логика
- `app/services/dispatch_worker.py` и соседние dispatch-сервисы - автодиспетчеризация
- `app/models/models.py` - основные ORM сущности

## Главные сущности БД

Чаще всего нужны:

- `users`
- `roles`
- `drivers`
- `vehicles`
- `orders`
- `order_items`
- `order_offers`
- `materials`
- `categories`
- `delivery_options`
- `media_files`
- `clients`
- `client_addresses`

Критичная связь:

- `Driver.user_id -> User.id`
- телефон водителя фактически живет и в `drivers.phone`, и как `users.username`

Из-за этого при удалении/архивации водителя нужно освобождать оба поля.

## Как устроен frontend

Исходники:

`/opt/darmavoz/frontend`

Собранная статика, которая реально отдается наружу:

`/opt/darmavoz/react_web`

Ключевые экраны:

- `frontend/src/App.tsx`
- `frontend/src/LoginScreen.tsx`
- `frontend/src/WelcomeScreen.tsx`
- `frontend/src/CartScreen.tsx`
- `frontend/src/OrdersScreen.tsx`
- `frontend/src/LogistDashboardScreen.tsx`
- `frontend/src/AdminDashboardScreen.tsx`
- `frontend/src/DriverProfileScreen.tsx`
- `frontend/src/DriverOrdersScreen.tsx`
- `frontend/src/DriverRegistrationScreen.tsx`
- `frontend/src/ClientProfileScreen.tsx`

Полезные frontend-файлы:

- `frontend/src/store.ts` - клиентский store
- `frontend/src/utils.ts` - `baseURL` и helper-логика
- `frontend/src/index.css` - глобальные стили

## Как трафик идет наружу

### Важно

Продовый Caddy использует не только репозиторный файл.

Актуальный live-конфиг Caddy находится здесь:

`/opt/daoos-kit/configs/sites/darmavoz.caddy`

Репозиторный файл:

`/opt/darmavoz/darmavoz.caddy`

Его полезно держать синхронно, но сам live-трафик обслуживает именно конфиг в DAOOS Kit.

### Основные маршруты домена

На текущем контуре:

- `/api/*`, `/docs`, `/health` -> backend
- `/s3/*` -> MinIO proxy
- `/darmavoz-media/*` -> MinIO proxy
- `/static/*` -> файлы из `/srv/darmavoz/static`
- `/` -> web-frontend

## Продовые сервисы

`docker-compose.yml` в `/opt/darmavoz` поднимает:

- `darmavoz_backend`
- `minio`

Проверка:

```bash
cd /opt/darmavoz
docker compose ps
```

## Критичный нюанс по деплою backend

Контейнер `darmavoz_backend` в проде собирается из image и не использует bind-mount исходников из `/opt/darmavoz/app`.

Это значит:

- изменение файлов на хосте само по себе не меняет код внутри уже запущенного контейнера
- простой `docker compose restart backend` не подхватывает изменения кода

Чтобы изменения backend реально применились, нужен один из способов:

1. корректный способ:
   `docker compose up -d --build backend`
2. быстрый аварийный способ:
   `docker cp ... darmavoz_backend:/app/...` и потом `docker compose restart backend`

Для мелких срочных багфиксов второй способ допустим, но нормальный путь - пересборка.

## Критичный нюанс по Caddy

У контейнера Caddy выключен admin API (`admin off`), поэтому `caddy reload` из контейнера не работает стандартно.

Если изменен live-файл:

`/opt/daoos-kit/configs/sites/darmavoz.caddy`

то применяй так:

```bash
docker exec daoos_kit-caddy-1 caddy validate --config /etc/caddy/Caddyfile
docker restart daoos_kit-caddy-1
```

## Критичный нюанс по S3 / MinIO

Конфиг лежит в:

- `app/core/config.py`
- `.env`
- `app/services/storage.py`

Сейчас для upload flow важно следующее:

- public S3 URL идут через `https://darmavoz.ru/s3/`
- presigned `PUT` сделан с TTL `3600` секунд
- browser CORS для upload в live-контуре обеспечивается через Caddy proxy на `/s3/*`

Практически важный факт:

- bucket-level `PutBucketCors` на этом MinIO/endpoint сейчас отвечает `NotImplemented`
- поэтому не рассчитывай, что bucket CORS можно надежно починить только через boto3 или `mc`
- рабочий контур загрузки обеспечивается proxy-level CORS в Caddy

Если правишь upload, всегда проверяй:

```bash
curl -k -I -X OPTIONS https://darmavoz.ru/s3/darmavoz-media/test-upload.jpg \
  -H 'Origin: https://app.example' \
  -H 'Access-Control-Request-Method: PUT' \
  -H 'Access-Control-Request-Headers: content-type'
```

Ожидается `204` и заголовки `Access-Control-Allow-*`.

## Недавние важные backend-фиксы

### 1. Освобождение телефонов при удалении водителя

При удалении водителя backend:

- деактивирует `driver`
- деактивирует `user`
- меняет `drivers.phone`
- меняет `users.username`

Формат освобождения:

`<старое значение>_del_<6 hex>`

Разовый data patch для старых данных:

`/opt/darmavoz/scripts/release_deleted_driver_phones.py`

Запуск:

```bash
docker exec darmavoz_backend sh -lc 'cd /app && PYTHONPATH=/app python scripts/release_deleted_driver_phones.py'
```

### 2. Русские ошибки и коды ошибок

В `app/api/auth.py` и `app/api/admin.py` часть конфликтов `409` переведена на structured detail:

```json
{
  "code": "SOME_ERROR_CODE",
  "message": "Русский текст ошибки"
}
```

Если продолжаешь эту линию, придерживайся такого же формата.

## Что проверять после backend-изменений

Минимум:

```bash
cd /opt/darmavoz
docker compose ps
docker logs --tail 50 darmavoz_backend
```

Если правился Python-код внутри контейнера:

```bash
docker exec darmavoz_backend python -m py_compile /app/app/api/auth.py
```

Подставляй нужные файлы.

Полезные smoke-checks:

```bash
cd /opt/darmavoz
./scripts/smoke_check.sh
```

Проверка доступности сайта и APK:

```bash
curl -k -I https://darmavoz.ru/
curl -k -I https://darmavoz.ru/static/darmavoz.apk
```

Ожидается `200 OK`.

## Что проверять после frontend-изменений

Сборка:

```bash
cd /opt/darmavoz/frontend
npm ci
npm run build
```

Дальше важно понять, куда именно выкладывается актуальная статика:

- исторически исходники собираются в `frontend/dist`
- live-раздача сейчас идет из `/opt/darmavoz/react_web` через Caddy

Поэтому после изменений фронта нужно отдельно проверить, что собранные файлы реально попали в `react_web`, иначе домен останется на старой версии.

## Полезные внешние URL

- `https://darmavoz.ru/`
- `https://darmavoz.ru/docs`
- `https://darmavoz.ru/health`
- `https://darmavoz.ru/static/darmavoz.apk`

API-примеры:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/driver/register`
- `GET /api/v1/drivers/`
- `GET /api/v1/logist/orders`
- `POST /api/v1/media/presign-upload`
- `POST /api/v1/media/confirm`

## Быстрый чек-лист для следующего захода

1. Подключиться по SSH.
2. Перейти в `/opt/darmavoz`.
3. Проверить `docker compose ps`.
4. Если задача про домен или статику, смотреть еще и `/opt/daoos-kit/configs/sites/darmavoz.caddy`.
5. Если задача про backend-код, помнить, что `restart` без пересборки не подтянет изменения с хоста.
6. Если задача про upload фото, проверять не только backend, но и Caddy CORS на `/s3/*`.
7. После изменений валидировать сервис снаружи через `curl`.

## Если нужно быстро сориентироваться по проекту

Читай в таком порядке:

1. `README.md`
2. `architecture.md`
3. `main.py`
4. нужный router в `app/api/`
5. связанные модели в `app/models/models.py`
6. связанные схемы в `app/schemas/`
7. связанные сервисы в `app/services/`

Это самый быстрый путь понять текущую реализацию без лишних догадок.
