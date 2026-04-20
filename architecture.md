# Архитектура бэкенда "Дармавоз" (Core API)

Этот файл является единым источником истины для текущего состояния серверной части проекта после Спринта 2.

## 1. Структура проекта

```text
backend/
├── alembic/                  # Миграции базы данных
├── app/
│   ├── api/                  # FastAPI роутеры
│   ├── core/                 # Конфигурация приложения
│   ├── db/                   # Сессии БД и seed
│   ├── models/               # SQLAlchemy ORM модели
│   ├── schemas/              # Pydantic схемы
│   ├── security/             # JWT и хеширование паролей
│   └── services/             # Бизнес-логика и интеграции
├── .env                      # Локальная конфигурация окружения
├── alembic.ini               # Конфигурация Alembic
├── docker-compose.yml        # PostgreSQL, Redis, FastAPI
├── Dockerfile                # Сборка backend-образа
├── entrypoint.sh             # Ожидание БД, миграции, запуск uvicorn
├── main.py                   # Точка входа FastAPI
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
- `phone` (`String`, unique, index)

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

## 5. Безопасность и роли

Авторизация построена на OAuth2 Password Flow + JWT.

Поддерживаемые роли Спринта 2:
- `admin` — полный административный доступ
- `logist` — операционный доступ логиста
- `manager` — управленческий read-only контур

Seed при старте приложения создает базовые роли и администратора из `.env`, если их еще нет.
