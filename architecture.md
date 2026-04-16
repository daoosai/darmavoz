# Архитектура бэкенда "Дармавоз" (Core API)

Этот файл является единым источником истины (Source of Truth) для структуры и конфигурации серверной части проекта.

## 1. Структура проекта

Бэкенд построен на базе **FastAPI** с асинхронным драйвером для БД.

```text
/ (Корень проекта)
├── alembic/                  # Миграции базы данных (скрипты и настройки)
├── app/
│   ├── api/                  # Эндпоинты (роутеры): auth.py, admin.py
│   ├── core/                 # Базовая конфигурация (config.py)
│   ├── db/                   # База данных: подключение (database.py), посев данных (seed.py)
│   ├── models/               # SQLAlchemy 2.0 ORM модели (models.py)
│   ├── schemas/              # Pydantic схемы для валидации данных (token.py)
│   ├── security/             # Логика безопасности: JWT, хеширование (auth.py, jwt.py)
│   └── services/             # Бизнес-логика приложения
├── .env                      # [LOCAL] Переменные окружения (gitignored)
├── .gitignore                # Настройки исключений Git
├── alembic.ini               # Конфигурация Alembic
├── architecture.md           # Этот файл (Source of Truth)
├── docker-compose.yml        # Оркестрация контейнеров (Backend, DB, Redis)
├── Dockerfile                # Сборка образа приложения
├── main.py                   # Точка входа в FastAPI приложение
└── requirements.txt          # Список зависимостей Python
```

> **Важно:** Папка `postgres_data/` и файл `.env` используются только в локальной среде разработки и добавлены в `.gitignore`. Они не должны попадать в систему контроля версий.

## 2. Инфраструктура (Docker)

Проект разворачивается через `docker-compose.yml` и включает три основных сервиса:

- **backend**: Приложение на Python 3.11-slim. Запускается через `uvicorn`. Зависит от `db` и `redis`.
- **db**: Реляционная база данных **PostgreSQL 15-alpine**.
- **redis**: Хранилище данных в памяти **Redis 7-alpine** (используется для кэширования и брокера задач).

## 3. Схема базы данных (PostgreSQL)

Схема реализована с использованием SQLAlchemy 2.0 (Mapped/mapped_column).

### Таблица: roles (Роли)
- `id` (Integer, PK)
- `name` (String: admin, logist, manager)
- `description` (String, nullable)

### Таблица: users (Пользователи)
- `id` (Integer, PK)
- `username` (String, unique, index)
- `hashed_password` (String)
- `role_id` (Integer, FK -> roles.id)
- `is_active` (Boolean, default: True)

### Таблица: clients (Клиенты)
- `id` (Integer, PK)
- `name` (String)
- `phone` (String, unique, index)

### Таблица: drivers (Водители)
- `id` (Integer, PK)
- `name` (String)
- `phone` (String, unique, index)
- `status` (String, nullable)

### Таблица: orders (Заказы)
- `id` (Integer, PK)
- `client_id` (Integer, FK -> clients.id)
- `driver_id` (Integer, FK -> drivers.id, nullable)
- `material` (String)
- `volume` (Float)
- `address` (Text)
- `status` (String)

### Таблица: events (Журнал событий)
- `id` (Integer, PK)
- `order_id` (Integer, FK -> orders.id, nullable)
- `event_type` (String)
- `description` (Text, nullable)
- `created_at` (DateTime, timezone=True)

## 4. Безопасность и JWT

- **Хеширование паролей**: Используется `passlib` с алгоритмом `bcrypt`.
- **Авторизация**: Реализована на базе **OAuth2 Password Flow** с использованием **JWT (JSON Web Token)**.
- **Токены**: Используется библиотека `python-jose`. Секретный ключ и время жизни токена настраиваются через `app/core/config.py`.
- **Зависимости**:
  - `get_current_user`: извлекает пользователя из токена.
  - `get_current_admin_user`: проверяет наличие роли `admin`.

---
Архитектура актуализирована по итогам Спринта 2.
