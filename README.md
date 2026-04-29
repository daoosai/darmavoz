# Darmavoz Backend

Текущий backend проекта находится на ноде в каталоге `/opt/darmavoz`.

## Что реально закрыто по спринтам 1-4

- Спринт 1: FastAPI backend, Docker, PostgreSQL, Redis, Alembic, health/docs endpoints.
- Спринт 2: JWT-аутентификация, роли `admin` / `logist` / `manager`, защищенные роуты для admin/logist/manager, базовые операции `create + list` для клиентов и водителей.
- Спринт 3: интеграция Avito webhook, идемпотентная запись `integration_events/channels/dialogues/messages`, admin endpoint для регистрации webhook.
- Спринт 4: AI-анализ входящих сообщений, запись `message_ai_analyses`, создание/обновление draft-заказа по результату анализа.

Важно: на текущий момент для `clients` и `drivers` реализованы только `create` и `list`. Полного CRUD пока нет, и это нужно учитывать при закрытии спринтов.

## Структура запуска

### Local development
Поднимает локальные `db`, `redis`, `backend`:

```bash
docker compose -f docker-compose.local.yml up -d --build
```

### Production
Поднимает только `backend`, который подключается к внешней сети `daoos_kit_default` и использует внешние Postgres/Redis из окружения:

```bash
docker compose up -d --build
```

## Публичные и локальные URL

- Local API: `http://localhost:8000`
- Local Swagger UI: `http://localhost:8000/docs`
- Local ReDoc: `http://localhost:8000/redoc`
- Local OpenAPI: `http://localhost:8000/openapi.json`
- Prod API/docs: `https://darmavoz.ru`, `https://darmavoz.ru/docs`

## Основные endpoints

- `GET /ping`
- `GET /health`
- `POST /api/v1/auth/login`
- `GET /api/v1/admin/stats`
- `GET /api/v1/admin/logist-area`
- `GET /api/v1/admin/manager-area`
- `POST /api/v1/admin/avito/webhook/register`
- `POST /api/v1/clients/`
- `GET /api/v1/clients/`
- `POST /api/v1/drivers/`
- `GET /api/v1/drivers/`
- `POST /api/v1/webhooks/avito`

## Avito webhook: фактический контракт

Эндпоинт:

```text
POST /api/v1/webhooks/avito
```

Сервис принимает webhook, если выполнено хотя бы одно условие:

- query-параметр `token` совпадает с `AVITO_WEBHOOK_URL_TOKEN`
- заголовок `X-Webhook-Secret` (или имя из `AVITO_WEBHOOK_HEADER_NAME`) совпадает с `AVITO_WEBHOOK_SECRET`
- source IP входит в `AVITO_WEBHOOK_ALLOWED_IPS`

Поддерживаются два формата payload:

1. Уже нормализованный внутренний:

```json
{
  "event_id": "evt_1",
  "account_id": "acc_1",
  "payload": {
    "chat_id": "chat_1",
    "user_id": "recipient_or_account_user_id",
    "sender_user_id": "author_user_id",
    "message_id": "msg_1",
    "text": "hello",
    "direction": "inbound",
    "message_type": "text"
  }
}
```

2. Реальный Avito-like payload, который сервер сам нормализует:

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
      "content": {"text": "hello"},
      "type": "text",
      "direction": "in"
    }
  }
}
```

Обязательные поля после нормализации: `event_id`, `account_id`, `chat_id`, `sender_user_id`, `message_id`.

Не-`inbound` сообщения сохраняются как обработанные события, но не создают сущности сообщения для AI pipeline.

## Seed пользователей

При старте приложение всегда создает роли `admin`, `logist`, `manager` и администратора из `.env`:

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
```

Отдельные учетные записи ролей создаются, если в `.env` заданы:

```env
LOGIST_USERNAME=logist
LOGIST_PASSWORD=logist
MANAGER_USERNAME=manager
MANAGER_PASSWORD=manager
```

Если эти переменные не заданы, пользователи `logist` и `manager` не создаются. На прод-ноде Darmavoz на 2026-04-29 они уже заведены и проходят login/smoke-проверку.

## Быстрая проверка

Есть короткий smoke script:

```bash
cd /opt/darmavoz
chmod +x scripts/smoke_check.sh
./scripts/smoke_check.sh
```

По умолчанию он проверяет:

- `GET /health`
- login `admin` и доступ к `/api/v1/admin/stats`
- `create + list` для `clients`
- `create + list` для `drivers`
- login `logist` и доступ к `/api/v1/admin/logist-area`
- login `manager` и доступ к `/api/v1/admin/manager-area`
- тестовый `POST /api/v1/webhooks/avito`

Скрипт сам подхватывает `.env` и по умолчанию использует:

- `BASE_URL=${BASE_URL:-${APP_BASE_URL:-https://darmavoz.ru}}`
- credentials/secret из `.env`

Если нужно переопределить окружение вручную:

```bash
BASE_URL=http://localhost:8000 \
ADMIN_USERNAME=admin \
ADMIN_PASSWORD=admin \
LOGIST_USERNAME=logist \
LOGIST_PASSWORD=logist \
MANAGER_USERNAME=manager \
MANAGER_PASSWORD=manager \
WEBHOOK_TOKEN=... \
WEBHOOK_SECRET=... \
./scripts/smoke_check.sh
```
