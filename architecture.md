# Архитектура бэкенда "Дармавоз" (Core API)

**Статус на 2026-05-12:** Спринт 9 завершен. Мобильный клиент (Flutter) интегрирован с бэкендом (FastAPI). Настроена маршрутизация (go_router), разделение контуров и система автообновлений. Ветка feature/epic-mobile-catalog.

Этот документ фиксирует фактическое состояние backend-проекта на ноде `дармавоз` в каталоге `/opt/darmavoz`.

## 1. Назначение текущего backend

Текущая серверная часть закрывает backend-контур MVP до конца Sprint 9:

- прием входящих сообщений из Авито;
- сохранение каналов, диалогов, сообщений и интеграционных событий;
- JWT-авторизацию и базовую ролевую модель;
- AI-классификацию входящих сообщений;
- извлечение параметров заказа из свободного текста;
- создание и обновление черновиков заказов;
- demo UI для ручной проверки цепочки `webhook -> AI -> draft order`.

Что пока не реализовано в текущем backend:

- автоматическая отправка уточняющих вопросов клиенту;
- интерфейс логиста для подтверждения карточки заказа;
- распределение по водителям, таймеры, MAX-интеграция.

## 2. Структура проекта

```text
/opt/darmavoz
├── alembic/                  # Миграции базы данных
├── app/
│   ├── api/                  # FastAPI роутеры
│   ├── core/                 # Конфигурация приложения
│   ├── db/                   # Сессии БД и seed
│   ├── integrations/         # Avito и LLM-клиенты
│   ├── models/               # SQLAlchemy ORM модели
│   ├── schemas/              # Pydantic схемы
│   ├── security/             # JWT и пароли
│   └── services/             # Бизнес-логика AI-обработки
├── static/                   # Demo UI
├── tests/                    # Unit и integration tests
├── .env                      # Локальная конфигурация
├── README.md                 # Операционная документация
├── architecture.md           # Этот документ
├── docker-compose.yml        # Production compose
├── docker-compose.local.yml  # Локальная разработка
├── Dockerfile
├── entrypoint.sh
├── main.py
└── requirements.txt
```

## 3. Инфраструктура и деплой

### Runtime

- Python 3.11
- FastAPI
- PostgreSQL
- Redis
- Docker Compose

### Production deployment

Текущая production-инсталляция работает на ноде `дармавоз` через `docker compose`.

Проверенные внешние точки:

- `https://darmavoz.ru/`
- `https://darmavoz.ru/health`
- `https://darmavoz.ru/docs`
- `https://darmavoz.ru/demo`

`/health` дополнительно возвращает флаг:

- `llm_configured: true|false`

Он показывает, настроен ли `LLM_API_KEY` в окружении контейнера.

## 4. API-поверхность

### Системные endpoints

- `GET /`
- `GET /ping`
- `GET /health`
- `GET /docs`
- `GET /redoc`
- `GET /openapi.json`
- `GET /demo`

### Основные API-модули

- `/api/v1/auth`
- `/api/v1/admin`
- `/api/v1/clients`
- `/api/v1/drivers`
- `/api/v1/orders`
- `/api/v1/webhooks`
- `/api/v1/catalog`
- `/api/v1/cart`

### Реально используемые в Sprint 6 endpoints

**Каталог и Корзина:**
- `GET /api/v1/catalog/categories/`
- `GET /api/v1/catalog/materials/`
- `GET /api/v1/catalog/materials/{id}`
- `GET /api/v1/cart/`
- `POST /api/v1/cart/items`
- `PATCH /api/v1/cart/items/{id}`
- `DELETE /api/v1/cart/items/{id}`

**Админка:**
- `GET /api/v1/admin/materials/`
- `POST /api/v1/admin/materials/`
- `PATCH /api/v1/admin/materials/{id}`

**Авторизация и Webhooks:**
- `POST /api/v1/auth/login`
- `POST /api/v1/webhooks/avito`
- `GET /api/v1/orders/`

## 5. Модель данных

Все ключевые таблицы используют `UUID`.

### roles

- `id`
- `name`
- `description`

Значения seed:

- `admin`
- `logist`
- `manager`

### users

- `id`
- `username`
- `hashed_password`
- `role_id`
- `is_active`

### clients

- `id`
- `name`
- `phone`
- `external_source`
- `external_user_id`

Ограничение:

- уникальная пара `external_source + external_user_id`

### drivers

- `id`
- `name`
- `phone`
- `status`

### orders

- `id`
- `client_id`
- `driver_id`
- `material`
- `volume`
- `address`
- `status`
- `source`
- `notes`
- `source_dialogue_id`
- `created_at`

Фактические статусы, присутствующие в модели:

- `draft`
- `pending`
- `assigned`
- `completed`
- `cancelled`

### events

- `id`
- `order_id`
- `event_type`
- `description`
- `created_at`

### order_offers

- `id`
- `order_id`
- `driver_id`
- `price`
- `status`
- `created_at`

### integration_events

- `id`
- `source`
- `external_event_id`
- `payload`
- `status`
- `error_message`
- `created_at`

Ограничение:

- уникальная пара `source + external_event_id`

### channels

- `id`
- `name`
- `external_account_id`
- `is_active`

Ограничение:

- уникальная пара `name + external_account_id`

### dialogues

- `id`
- `channel_id`
- `external_dialog_id`
- `client_id`
- `order_id`
- `status`
- `last_message_at`
- `created_at`

Ограничение:

- уникальная пара `channel_id + external_dialog_id`

### messages

- `id`
- `dialogue_id`
- `external_message_id`
- `direction`
- `message_type`
- `text`
- `raw_payload`
- `created_at`

Ограничение:

- уникальная пара `dialogue_id + external_message_id`

### message_ai_analyses

Таблица Sprint 4.

- `id`
- `message_id`
- `dialogue_id`
- `classification`
- `raw_llm_response`
- `normalized_json`
- `confidence`
- `missing_fields`
- `status`
- `error_message`
- `created_at`

Типовые статусы анализа:

- `processed`
- `failed`
- `needs_review`

## 6. Интеграции

### 6.1. Avito webhook

Точка входа:

- `POST /api/v1/webhooks/avito`

Поддерживаемые способы авторизации webhook:

- заголовок `X-Webhook-Secret`;
- query-параметр `token`;
- allowlist IP через `AVITO_WEBHOOK_ALLOWED_IPS`.

Фактическая логика:

1. Вебхук валидируется.
2. Сырое событие сохраняется в `integration_events`.
3. Канал, клиент, диалог и сообщение создаются или переиспользуются.
4. Для нового входящего сообщения запускается background AI-обработка.

Идемпотентность обеспечивается на двух уровнях:

- событие: `source + external_event_id`;
- сообщение: `dialogue_id + external_message_id`.

### 6.2. LLM / ProxyAPI

В текущем прод-контуре LLM работает через ProxyAPI как совместимый транспорт OpenAI SDK.

Конфигурационные переменные:

- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_MODEL`
- `LLM_TIMEOUT_SECONDS`
- `LLM_MAX_RETRIES`
- `LLM_TEMPERATURE`

Текущие defaults:

- `LLM_BASE_URL=https://api.proxyapi.ru/openai/v1`
- `LLM_MODEL=gpt-4o-mini`
- `LLM_TEMPERATURE=0.0`

## 7. Логика Sprint 4

### 7.1. Классификация сообщения

Поддерживаемые классы:

- `new_order`
- `order_update`
- `question`
- `irrelevant`

### 7.2. Нормализованный AI-ответ

LLM обязана вернуть валидируемую JSON-структуру, содержащую:

- `classification`
- `is_order_related`
- `client_message_summary`
- `order_fields`
- `missing_fields`
- `needs_clarification`
- `should_create_order_draft`
- `confidence`

Извлекаемые поля заказа:

- `material`
- `volume`
- `address`
- `datetime_str`
- `client_name`
- `client_phone`
- `notes`

### 7.3. Создание черновика заказа

Если `should_create_order_draft=true`, backend:

1. ищет существующий `dialogue.order_id`;
2. если заказ draft, обновляет его;
3. если заказа нет, создает новый `orders.status='draft'`;
4. связывает заказ с диалогом;
5. сохраняет summary и доп. детали в `orders.notes`.

### 7.4. Защита от порчи не-draft заказов

Если к диалогу уже привязан заказ не в статусе `draft`, AI не перезаписывает его.

В этом случае:

- анализ сохраняется;
- `message_ai_analyses.status = needs_review`;
- `error_message = "Cannot update non-draft order"`.

## 8. Логика работы Каталога (Sprint 6)

### 8.1. Скрытие неактивных материалов
Материалы имеют флаг `is_active` (boolean). 
- Если `is_active=false`, материал не возвращается в публичном списке `GET /api/v1/catalog/materials/`. Таким образом он пропадает из витрины клиентского приложения.
- При этом он остается доступным при запросе по конкретному ID `GET /api/v1/catalog/materials/{id}`, а также возвращается в `GET /api/v1/admin/materials/`.
**Почему так сделано:** Это необходимо для сохранения ссылочной целостности (referential integrity) в уже существующих заказах и корзинах. Если материал был заказан, а затем скрыт менеджером (например, временно нет в наличии), старые заказы и элементы корзины продолжат корректно отображать информацию о материале, не вызывая ошибок `404 Not Found`.

## 9. Demo UI

`/demo` добавлен как ручной интерфейс проверки Sprint 4.

Он позволяет:

- авторизоваться через `POST /api/v1/auth/login`;
- отправить тестовый webhook Авито;
- увидеть последние 10 заказов;
- проверить, как AI породил или не породил черновик.

Demo UI не является полноценным интерфейсом логиста. Это инструмент проверки контура Sprint 3 + 4.

## 9. Тестовое покрытие

В проекте есть автоматические тесты для:

- webhook-auth и идемпотентности Авито;
- AI-классификации и draft order logic;
- protection от изменения non-draft заказов;
- demo orders endpoint и demo page.

На момент актуализации документации на ноде проходил полный набор:

- `pytest -q` -> `31 passed`

## 10. Известные ограничения

- `needs_clarification` пока только сохраняется в результате AI-анализа и не инициирует отправку вопроса клиенту.
- Нет отдельного UI логиста для подтверждения и ручного редактирования карточки заказа.
- `GET /api/v1/orders/` сейчас используется как demo endpoint последних 10 заказов, а не как полноценный реестр заказов.
- В production сейчас развернута ветка `feature/demo-ui`; это допустимо для стенда, но для формального релиза лучше фиксировать release-ветку или `main`.

## 11. Рекомендуемый порядок ручной проверки

1. Проверить `https://darmavoz.ru/health`.
2. Открыть `https://darmavoz.ru/docs`.
3. Авторизоваться в `https://darmavoz.ru/demo`.
4. Отправить тестовое inbound-сообщение через demo webhook simulator.
5. Убедиться, что в `/api/v1/orders/` появился или обновился draft order.
6. Проверить, что при нерелевантном сообщении новый заказ не создается.

## 12. Вывод

Текущее состояние backend соответствует завершенному Sprint 4:

- Авито-интеграция работает;
- AI-анализ включен;
- JSON-валидация ответа LLM есть;
- draft order creation реализован;
- внешний production URL отвечает.
