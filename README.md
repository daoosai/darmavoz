# Darmavoz Backend

## LLM ProxyAPI

Для Спринта 4 AI-обработка использует ProxyAPI как совместимый транспорт для официального OpenAI SDK.

Нужно настроить переменные окружения:

```env
LLM_API_KEY=your-proxyapi-key
LLM_BASE_URL=https://api.proxyapi.ru/openai/v1
LLM_MODEL=gpt-4o-mini
LLM_TIMEOUT_SECONDS=30
LLM_MAX_RETRIES=3
LLM_TEMPERATURE=0.0
```

Пример полного набора переменных находится в `.env.example`.

## Запуск

### Локальная разработка
Запуск полного стека (backend, db, redis):
```bash
docker compose -f docker-compose.local.yml up -d --build
```

### Production (DAOOS Kit)
Запуск только сервиса backend, подключенного к внешней сети `daoos_kit_default` с базой и redis:
```bash
docker compose up -d --build
```

## Сервисы

- API: `http://localhost:8000`
- Healthcheck: `http://localhost:8000/health`
- Swagger UI (Local): `http://localhost:8000/docs`
- Swagger UI (Prod): `https://darmavoz.ru/docs`
- ReDoc: `http://localhost:8000/redoc`
- OpenAPI schema: `http://localhost:8000/openapi.json`

## Как проверить Sprint 3 (Интеграция Авито)

1. **Получить токен администратора:**
   Авторизуйтесь через Swagger UI или отправьте запрос `POST /api/v1/auth/login` с логином и паролем администратора.
2. **Регистрация вебхука (Admin API):**
   Отправьте POST-запрос с токеном авторизации на `/api/v1/admin/avito/webhook/register` с телом:
   ```json
   {
     "webhook_url": "https://darmavoz.ru/api/v1/webhooks/avito"
   }
   ```
3. **Тестовый вебхук:**
   Отправьте POST-запрос на `/api/v1/webhooks/avito`, добавив заголовок `X-Webhook-Secret: <ваш_секрет>` и тело с JSON-структурой вебхука.

## Что покрыто Спринтами 1-2

- FastAPI + Docker Compose + PostgreSQL + Redis
- Alembic миграции
- Базовые сущности на UUID
- JWT-авторизация
- Seed ролей `admin`, `logist`, `manager`
- Seed администратора из `.env`
