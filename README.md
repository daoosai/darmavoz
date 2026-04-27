# Darmavoz Backend

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
