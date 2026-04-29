# Архитектура бэкенда "Дармавоз" (актуальное состояние)

Статус на 2026-04-29: backend развернут как FastAPI-приложение в каталоге `/opt/darmavoz`. Документ фиксирует фактическое состояние кода, а не целевую архитектуру.

## 1. Структура проекта

```text
/opt/darmavoz
├── alembic/                  # Миграции БД
├── app/
│   ├── api/                  # FastAPI роутеры: auth, admin, clients, drivers, webhooks
│   ├── core/                 # Settings / конфигурация
│   ├── db/                   # Engine, session factory, startup seed
│   ├── integrations/
│   │   ├── avito/            # Схемы, webhook service, Avito management/API client
│   │   └── openai/           # LLM transport через совместимый OpenAI client
│   ├── models/               # SQLAlchemy ORM модели
│   ├── schemas/              # Pydantic схемы
│   ├── security/             # JWT, password hashing, role guards
│   └── services/             # AI background processing сообщений
├── scripts/                  # Операционные вспомогательные скрипты
├── tests/                    # Pytest
├── docker-compose.yml        # Production compose: только backend
├── docker-compose.local.yml  # Local compose: db + redis + backend
├── Dockerfile
├── entrypoint.sh
├── main.py
├── README.md
└── requirements.txt
```

## 2. Runtime topology

### Local
`docker-compose.local.yml` поднимает три сервиса:

- `db` (`postgres:15-alpine`)
- `redis` (`redis:7-alpine`)
- `backend`

`backend` публикуется наружу через `ports: 8000:8000` и зависит от локальных `db` и `redis`.

### Production
`docker-compose.yml` поднимает только:

- `backend`

Особенности prod-контура:

- контейнер подключается к внешней docker-сети `daoos_kit_default`
- порт наружу не публикуется; используется `expose: 8000`
- Postgres/Redis приходят из внешнего окружения через `.env`
- внешний HTTP(S) трафик терминируется отдельным Caddy в DAOOS Kit

## 3. Маршрутизация через Caddy

Фактический site-config:

```caddy
darmavoz.ru {
  reverse_proxy darmavoz_backend:8000
}
```

Выводы:

- path-based routing для Darmavoz сейчас не используется
- Caddy не переписывает пути и не добавляет отдельные upstream rules для `/api`, `/docs` или webhook
- весь трафик домена `https://darmavoz.ru/*` проксируется напрямую в FastAPI container `darmavoz_backend:8000`

## 4. Точка входа приложения

`main.py`:

- поднимает `FastAPI(title="Дармавоз.рф API")`
- в `lifespan` запускает `seed_data()`
- подключает роутеры:
  - `/api/v1/auth`
  - `/api/v1/admin`
  - `/api/v1/clients`
  - `/api/v1/drivers`
  - `/api/v1/webhooks`
- экспортирует service endpoints:
  - `GET /`
  - `GET /ping`
  - `GET /health`

`/health` дополнительно показывает `llm_configured`.

## 5. Конфигурация

Основные runtime settings читаются из `.env` через `pydantic-settings`:

- `DATABASE_URL`
- `REDIS_URL`
- `SECRET_KEY`
- `ALGORITHM`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `LOGIST_USERNAME`, `LOGIST_PASSWORD` (optional)
- `MANAGER_USERNAME`, `MANAGER_PASSWORD` (optional)
- `AVITO_WEBHOOK_SECRET`
- `AVITO_WEBHOOK_HEADER_NAME`
- `AVITO_WEBHOOK_URL_TOKEN`
- `AVITO_WEBHOOK_ALLOWED_IPS`
- `AVITO_CLIENT_ID`
- `AVITO_CLIENT_SECRET`
- `AVITO_ACCOUNT_ID`
- `AVITO_BASE_URL`
- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_MODEL`
- `LLM_TIMEOUT_SECONDS`
- `LLM_MAX_RETRIES`
- `LLM_TEMPERATURE`

## 6. Безопасность и роли

Авторизация построена на OAuth2 Password Flow + JWT.

Role guards:

- `get_current_admin_user` -> только `admin`
- `get_current_logist_user` -> `admin` или `logist`
- `get_current_manager_user` -> `admin` или `manager`

Startup seed:

- гарантирует наличие ролей `admin`, `logist`, `manager`
- всегда создает/поддерживает пользователя `admin` из env
- опционально создает пользователей `logist` и `manager`, если заданы их env credentials

Фактическое состояние prod на 2026-04-29:

- в `.env` заданы отдельные учетные записи `logist` и `manager`
- в прод-БД присутствуют и активны пользователи `admin`, `logist`, `manager`

## 7. API surface

### Auth
- `POST /api/v1/auth/login`
  - принимает `OAuth2PasswordRequestForm`
  - возвращает `{access_token, token_type}`

### Admin
- `GET /api/v1/admin/stats`
- `GET /api/v1/admin/logist-area`
- `GET /api/v1/admin/manager-area`
- `POST /api/v1/admin/avito/webhook/register`

`/api/v1/admin/avito/webhook/register` требует `admin` и вызывает Avito management service.

### Clients
- `POST /api/v1/clients/`
- `GET /api/v1/clients/`

Доступ: `admin` или `logist`.

Текущее ограничение: update/delete endpoints отсутствуют.

### Drivers
- `POST /api/v1/drivers/`
- `GET /api/v1/drivers/`

Доступ: `admin` или `logist`.

Текущее ограничение: update/delete endpoints отсутствуют.

### Webhooks
- `POST /api/v1/webhooks/avito`

## 8. Фактический webhook-контракт Avito

### Аутентификация webhook

Запрос считается валидным, если выполнено хотя бы одно условие:

1. `?token=<value>` совпадает с `AVITO_WEBHOOK_URL_TOKEN`
2. заголовок `AVITO_WEBHOOK_HEADER_NAME` совпадает с `AVITO_WEBHOOK_SECRET`
3. source IP запроса попадает в `AVITO_WEBHOOK_ALLOWED_IPS`

Если хотя бы один механизм настроен, а запрос не проходит проверку, endpoint возвращает `403`.

Если ни token, ни secret, ни allowlist не настроены, webhook endpoint фактически открыт.

### Поддерживаемые форматы payload

#### Нормализованный внутренний

```json
{
  "event_id": "evt_1",
  "account_id": "acc_1",
  "payload": {
    "chat_id": "chat_1",
    "user_id": "acc_1",
    "sender_user_id": "user_1",
    "message_id": "msg_1",
    "text": "Нужен щебень",
    "direction": "inbound",
    "message_type": "text"
  }
}
```

#### Реальный Avito-like payload

```json
{
  "id": "evt_1",
  "payload": {
    "type": "message",
    "value": {
      "id": "msg_1",
      "chat_id": "chat_1",
      "user_id": "acc_1",
      "author_id": "user_1",
      "content": {
        "text": "Нужен щебень"
      },
      "type": "text",
      "direction": "in"
    }
  }
}
```

Схема приводит Avito payload к внутреннему контракту автоматически.

### Обязательные поля после нормализации

- `event_id`
- `account_id`
- `payload.chat_id`
- `payload.sender_user_id`
- `payload.message_id`

`text` может отсутствовать (`null`).

### Поведение обработки

1. Raw payload сохраняется в `integration_events` с идемпотентностью по `source + external_event_id`.
2. Если событие дубль, обработка безопасно завершается.
3. Для `direction != inbound` событие помечается `processed`, но сообщение в AI pipeline не создается.
4. Для inbound-сообщения сервис upsert'ит:
   - `channels`
   - `clients`
   - `dialogues`
   - `messages`
5. Если создано новое inbound message, в background ставится AI processing task.

### Response behavior

- `200` -> обработано или безопасно проигнорировано как duplicate/non-inbound
- `403` -> webhook auth не пройден
- `422` -> payload не соответствует схеме
- `500` -> ошибка в бизнес-обработке после приема события

## 9. Модель данных

Основные сущности:

- `roles`
- `users`
- `clients`
- `drivers`
- `orders`
- `events`
- `order_offers`
- `integration_events`
- `channels`
- `dialogues`
- `messages`
- `message_ai_analyses`

Особенности текущей модели:

- все PK на `UUID`
- `clients.phone` может быть `NULL`
- Avito clients идентифицируются через `external_source + external_user_id`
- `orders` уже содержат поля под AI draft flow: `source`, `notes`, `source_dialogue_id`
- `dialogues` могут быть привязаны к `order_id`

## 10. Проверяемость

Для быстрой ручной/CI-проверки есть `scripts/smoke_check.sh`, который валидирует:

- `GET /health`
- admin login + `GET /api/v1/admin/stats`
- `clients create + list`
- `drivers create + list`
- `logist` login + `GET /api/v1/admin/logist-area`
- `manager` login + `GET /api/v1/admin/manager-area`
- test Avito webhook

Фактическое поведение smoke script:

- перед запуском подхватывает `.env`, если файл существует
- по умолчанию использует `BASE_URL=${BASE_URL:-${APP_BASE_URL:-https://darmavoz.ru}}`
- читает `ADMIN_*`, `LOGIST_*`, `MANAGER_*`, `AVITO_WEBHOOK_*` из окружения
- подходит как для локального контура, так и для prod без ручной правки самого скрипта

Для более глубокой проверки используются pytest tests из `tests/`.
