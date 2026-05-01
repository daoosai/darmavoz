# Darmavoz Backend

Backend проекта `Дармавоз.рф` на FastAPI. Текущее фактическое состояние на ноде `дармавоз` закрывает Sprint 4: Авито webhook, AI-классификация сообщений, извлечение параметров заказа, создание черновиков заказов и demo UI для ручной проверки.

## Что реализовано сейчас

- FastAPI backend с OpenAPI-документацией;
- PostgreSQL + Redis;
- Alembic миграции;
- JWT-авторизация;
- seed ролей `admin`, `logist`, `manager` и администратора из `.env`;
- интеграция с Авито webhook;
- сохранение `integration_events`, `channels`, `dialogues`, `messages`;
- AI-обработка входящих сообщений через ProxyAPI/OpenAI SDK;
- создание и обновление draft orders;
- demo UI на `/demo`.

## Актуальные URL

Production:

- `https://darmavoz.ru/`
- `https://darmavoz.ru/health`
- `https://darmavoz.ru/docs`
- `https://darmavoz.ru/redoc`
- `https://darmavoz.ru/openapi.json`
- `https://darmavoz.ru/demo`

Локально внутри контейнера:

- `http://127.0.0.1:8000/`
- `http://127.0.0.1:8000/health`
- `http://127.0.0.1:8000/docs`

## Переменные окружения

Обязательная база:

```env
DATABASE_URL=postgresql+asyncpg://postgres:postgres@db:5432/darmavoz
REDIS_URL=redis://redis:6379/0
SECRET_KEY=change-me
ALGORITHM=HS256
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
AVITO_WEBHOOK_SECRET=change-me
AVITO_WEBHOOK_HEADER_NAME=X-Webhook-Secret
AVITO_WEBHOOK_URL_TOKEN=
AVITO_WEBHOOK_ALLOWED_IPS=
```

Авито:

```env
AVITO_CLIENT_ID=
AVITO_CLIENT_SECRET=
AVITO_ACCOUNT_ID=
AVITO_BASE_URL=https://api.avito.ru
```

LLM / Sprint 4:

```env
LLM_API_KEY=your-proxyapi-key
LLM_BASE_URL=https://api.proxyapi.ru/openai/v1
LLM_MODEL=gpt-4o-mini
LLM_TIMEOUT_SECONDS=30
LLM_MAX_RETRIES=3
LLM_TEMPERATURE=0.0
```

Полный пример есть в `.env.example`.

## Запуск

### Локальная разработка

Полный стек backend + db + redis:

```bash
docker compose -f docker-compose.local.yml up -d --build
```

### Production на ноде

```bash
docker compose up -d --build
```

### Полезные команды

Проверка контейнеров:

```bash
docker compose ps
```

Текущая миграция:

```bash
docker compose exec -T backend alembic current
```

Полный тестовый прогон:

```bash
docker compose exec -T backend pytest -q
```

## Основные API-маршруты

- `POST /api/v1/auth/login`
- `POST /api/v1/webhooks/avito`
- `GET /api/v1/orders/`
- `GET /health`
- `GET /docs`
- `GET /demo`

## Как устроен Sprint 4

### Поток обработки

1. Авито присылает webhook в `POST /api/v1/webhooks/avito`.
2. Backend валидирует webhook.
3. Событие сохраняется в `integration_events`.
4. Создаются или переиспользуются `channel`, `client`, `dialogue`, `message`.
5. Для нового сообщения запускается background AI-processing.
6. AI возвращает структурированный JSON.
7. Если сообщение связано с заказом, backend создает или обновляет `draft` заказ.

### Классификация сообщений

Поддерживаемые классы:

- `new_order`
- `order_update`
- `question`
- `irrelevant`

### Извлекаемые поля

- `material`
- `volume`
- `address`
- `datetime_str`
- `client_name`
- `client_phone`
- `notes`

### Важное ограничение

Если у диалога уже есть заказ не в статусе `draft`, AI не перезаписывает его. Анализ сохраняется со статусом `needs_review`.

## Как проверить Sprint 4 вручную

### Вариант 1. Внешняя проверка через production

1. Откройте `https://darmavoz.ru/health` и убедитесь, что сервис отвечает `200`.
2. Проверьте `llm_configured=true`.
3. Откройте `https://darmavoz.ru/docs`.
4. Откройте `https://darmavoz.ru/demo`.
5. Авторизуйтесь логином и паролем администратора.
6. Укажите `Webhook Secret`.
7. Отправьте тестовое сообщение клиента.
8. Обновите список заказов и проверьте появление draft order.

Примеры сообщений:

- заказ: `Нужен песок 10 кубов на завтра, Тюмень, улица Ленина 10`
- уточнение: `Измените объем на 12 кубов`
- вопрос: `Сколько стоит доставка?`
- нерелевантное: `Спасибо`

### Вариант 2. Автотесты

```bash
docker compose exec -T backend pytest -q
```

На момент актуализации документации тесты проходили:

```text
31 passed
```

## Что проверяют тесты

- `tests/test_avito_webhook.py`
  - auth webhook;
  - token auth;
  - IP allowlist;
  - идемпотентность событий;
  - идемпотентность сообщений;
  - постановку background AI-задачи.

- `tests/test_ai_processor.py`
  - инициализацию OpenAI client через `LLM_BASE_URL`;
  - создание draft order;
  - обновление draft order;
  - отсутствие draft для `question` и `irrelevant`;
  - сохранение `failed` статуса при ошибке LLM;
  - защиту non-draft order от AI-перезаписи.

- `tests/test_demo_orders.py`
  - auth guard для `/api/v1/orders/`;
  - выдачу последних 10 заказов;
  - доступность `/demo`.

## Текущее состояние документации

- `README.md` — быстрый операционный вход и чек-листы;
- `architecture.md` — фактическая архитектура и модель данных;
- `full_task.md` — исходное ТЗ в истории проекта, не является рабочим runtime-документом.

## Известные ограничения текущего backend

- `needs_clarification` пока только сохраняется в AI-анализе и не приводит к автоматической отправке вопроса клиенту.
- Полноценного web-интерфейса логиста пока нет; вместо него есть demo UI.
- `/api/v1/orders/` пока играет роль demo-реестра последних заказов, а не полного production-реестра.
- Исторически в БД может встречаться `message_ai_analyses.status='failed'`, если в момент проверки не был настроен `LLM_API_KEY`.

## Смежные файлы

- `architecture.md`
- `.env.example`
- `main.py`
- `app/services/message_ai_processor.py`
- `app/integrations/openai/client.py`
- `app/api/webhooks.py`
