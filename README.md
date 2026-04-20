# Darmavoz Backend

## Запуск

```bash
docker compose up -d --build
```

## Сервисы

- API: `http://localhost:8000`
- Healthcheck: `http://localhost:8000/health`
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`
- OpenAPI schema: `http://localhost:8000/openapi.json`

## Что покрыто Спринтами 1-2

- FastAPI + Docker Compose + PostgreSQL + Redis
- Alembic миграции
- Базовые сущности на UUID
- JWT-авторизация
- Seed ролей `admin`, `logist`, `manager`
- Seed администратора из `.env`
