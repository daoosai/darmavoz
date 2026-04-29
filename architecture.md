# Архитектура бэкенда "Дармавоз" (Core API)

**Статус:** Спринт 4 в работе. Реализованы интеграция Авито, AI-анализ сообщений и черновики заказов.

Этот файл является единым источником истины для текущего состояния серверной части проекта после Спринта 4.

## 1. Структура проекта

```text
backend/
├── alembic/                  # Миграции базы данных
├── app/
│   ├── api/                  # FastAPI роутеры
│   ├── core/                 # Конфигурация приложения
│   ├── db/                   # Сессии БД и seed
│   ├── integrations/         # Внешние интеграции (например, Avito API и Webhooks)
│   ├── models/               # SQLAlchemy ORM модели
│   ├── schemas/              # Pydantic схемы
│   ├── security/             # JWT и хеширование паролей
│   └── services/             # Бизнес-логика
├── tests/                    # Интеграционные и unit-тесты (Pytest)
├── .env                      # Локальная конфигурация окружения
├── alembic.ini               # Конфигурация Alembic
├── docker-compose.yml        # Production-файл для DAOOS Kit (только backend)
├── Dockerfile                # Сборка backend-образа
├── entrypoint.sh             # Ожидание БД, миграции, запуск uvicorn
├── main.py                   # Точка входа FastAPI
├── pytest.ini                # Конфигурация Pytest
├── README.md                 # Быстрый старт и автодокументация API
└── requirements.txt          # Python-зависимости
```

## 2. Инфраструктура

Сервисный контур поднимается через Docker Compose и включает:
- `backend`: FastAPI приложение на Python 3.11.
- `db`: PostgreSQL 15.
- `redis`: Redis 7.

Базовая конфигурация хранится в `.env` и читается через `pydantic-settings`.

## 3. Автодокументирование API

FastAPI формирует OpenAPI-схему автоматически.
Доступные точки автодокументации:
- `/docs` — Swagger UI
- `/redoc` — ReDoc
- `/openapi.json` — OpenAPI schema

## 4. Схема базы данных

Все первичные ключи и внешние ключи реализованы на `UUID`.

### roles
- `id` (`UUID`, PK)
- `name` (`String`, unique): `admin`, `logist`, `manager`
- `description` (`String`, nullable)

### users
- `id` (`UUID`, PK)
- `username` (`String`, unique, index)
- `hashed_password` (`String`)
- `role_id` (`UUID`, FK -> `roles.id`)
- `is_active` (`Boolean`)

### clients
- `id` (`UUID`, PK)
- `name` (`String`)
- `phone` (`String`, unique, index, nullable=True)
- `external_source` (`String`, nullable)
- `external_user_id` (`String`, nullable)
- Уникальный индекс: `external_source` + `external_user_id`

### drivers
- `id` (`UUID`, PK)
- `name` (`String`)
- `phone` (`String`, unique, index)
- `status` (`String`, nullable)

### orders
- `id` (`UUID`, PK)
- `client_id` (`UUID`, FK -> `clients.id`)
- `driver_id` (`UUID`, FK -> `drivers.id`, nullable)
- `material` (`String`)
- `volume` (`Float`)
- `address` (`Text`)
- `status` (`String`)

### events
- `id` (`UUID`, PK)
- `order_id` (`UUID`, FK -> `orders.id`, nullable)
- `event_type` (`String`)
- `description` (`Text`, nullable)
- `created_at` (`DateTime(timezone=True)`)

### order_offers
- `id` (`UUID`, PK)
- `order_id` (`UUID`, FK -> `orders.id`)
- `driver_id` (`UUID`, FK -> `drivers.id`)
- `price` (`Float`)
- `status` (`String`)
- `created_at` (`DateTime(timezone=True)`)

### integration_events
- `id` (`UUID`, PK)
- `source` (`String`): например, 'avito'
- `external_event_id` (`String`): ID события во внешней системе
- `payload` (`JSONB`): сырой вебхук
- `status` (`String`): `received`, `processed`, `failed`
- `error_message` (`Text`, nullable)
- `created_at` (`DateTime(timezone=True)`)
- Уникальный индекс: `source` + `external_event_id`

### channels
- `id` (`UUID`, PK)
- `name` (`String`): например, 'avito'
- `external_account_id` (`String`): ID нашего аккаунта/бота
- `is_active` (`Boolean`, default=True)
- Уникальный индекс: `name` + `external_account_id`

### dialogues
- `id` (`UUID`, PK)
- `channel_id` (`UUID`, FK -> `channels.id`)
- `external_dialog_id` (`String`): ID чата в Авито
- `client_id` (`UUID`, FK -> `clients.id`, nullable)
- `order_id` (`UUID`, FK -> `orders.id`, nullable)
- `status` (`String`): `open`, `closed`
- `last_message_at` (`DateTime(timezone=True)`, nullable)
- `created_at` (`DateTime(timezone=True)`)
- Уникальный индекс: `channel_id` + `external_dialog_id`

### messages
- `id` (`UUID`, PK)
- `dialogue_id` (`UUID`, FK -> `dialogues.id`)
- `external_message_id` (`String`): ID сообщения в Авито
- `direction` (`String`): `inbound`, `outbound`
- `message_type` (`String`): `text`, `system`, `media`
- `text` (`Text`, nullable)
- `raw_payload` (`JSONB`, nullable)
- `created_at` (`DateTime(timezone=True)`)
- Уникальный индекс: `dialogue_id` + `external_message_id`

## 5. Интеграции

Вся логика интеграций изолирована в модуле `app/integrations`.

**Авито:**
- Логика находится в `app/integrations/avito`.
- Точка входа для вебхуков: `POST /api/v1/webhooks/avito`.
- Реализована строгая идемпотентность через составные уникальные ключи (`UniqueConstraint`).
- Сырые вебхуки сначала сохраняются в `integration_events`, после чего парсятся и распределяются по сущностям `channels`, `dialogues`, `messages`.

**LLM / ProxyAPI:**
- В Спринте 4 для LLM-транспорта используется ProxyAPI: `https://api.proxyapi.ru/openai/v1`.
- ProxyAPI полностью совместим с официальным SDK OpenAI, поэтому приложение продолжает использовать `AsyncOpenAI` и `beta.chat.completions.parse(...)`.
- Конфигурация задается через переменные `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_TIMEOUT_SECONDS`, `LLM_MAX_RETRIES`, `LLM_TEMPERATURE`.

## 5.1 Operational Block: Avito Webhook

### Endpoint
- `POST /api/v1/webhooks/avito`

### Security Header
- Заголовок: `X-Webhook-Secret`
- Значение сравнивается с `AVITO_WEBHOOK_SECRET` через `secrets.compare_digest()`
- При неверном или отсутствующем секрете сервис возвращает `403`

### Payload Contract
- Верхний уровень:
  - `event_id: str`
  - `account_id: str`
  - `payload: object`
- Вложенный `payload`:
  - `chat_id: str`
  - `user_id: str`
  - `message_id: str`
  - `text: str`
- Все неизвестные поля игнорируются на уровне Pydantic-схемы, но обязательные поля валидируются строго

### Response Codes
- `200 OK`:
  - вебхук успешно обработан
  - либо пришел дубль события и был безопасно проигнорирован
- `403 Forbidden`:
  - отсутствует или неверен секрет вебхука
- `422 Unprocessable Entity`:
  - нарушен JSON-контракт входящего payload
- `500 Internal Server Error`:
  - событие сохранено в `integration_events`, но дальнейшая бизнес-обработка завершилась ошибкой

### Idempotency Logic
- Уровень 1: входящее событие уникально по паре `source + external_event_id`
- Уровень 2: сообщение уникально в рамках диалога по паре `dialogue_id + external_message_id`
- Один и тот же `message_id` может существовать в разных диалогах
- Даже при ошибке бизнес-логики исходный webhook сначала фиксируется в `integration_events`

### Processing Flow
- Сервис логирует этапы `event_received`, `duplicate_event`, `channel_created/reused`, `client_created/reused`, `dialogue_created/reused`, `message_created` и `event_processed`
- Канал ищется или создается по `name='avito'` и `external_account_id`
- Клиент ищется или создается по `external_source='avito'` и `external_user_id`
- Для клиентов из Авито поле `phone` остается `NULL`

## 6. Безопасность и роли

Авторизация построена на OAuth2 Password Flow + JWT.

Поддерживаемые роли Спринта 2:
- `admin` — полный административный доступ
- `logist` — операционный доступ логиста
- `manager` — управленческий read-only контур

Seed при старте приложения создает базовые роли и администратора из `.env`, если их еще нет.
