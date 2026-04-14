# Архитектура проекта "Дармавоз.рф" (Core API)

## 1. Структура проекта (Backend - FastAPI)
Проект строится по модульной архитектуре с разделением слоев (Domain-Driven Design).

/backend
├── /app
│   ├── /api          # Эндпоинты (роуты) FastAPI
│   ├── /core         # Настройки, конфигурация (config, security)
│   ├── /db           # Подключение к PostgreSQL и сессии (SQLAlchemy)
│   ├── /models       # ORM модели базы данных (таблицы)
│   ├── /schemas      # Pydantic схемы (валидация входящих/исходящих данных)
│   └── /services     # Бизнес-логика и интеграции (AI, Avito, MAX)
├── Dockerfile        # Конфигурация контейнера
├── requirements.txt  # Зависимости Python
└── main.py           # Точка входа приложения

## 2. Структура Базы Данных (PostgreSQL)

Таблица: clients (Клиенты)
- id (UUID, PK)
- name (String)
- phone (String)
- source (String) # Например: 'avito'

Таблица: drivers (Водители)
- id (UUID, PK)
- name (String)
- phone (String)
- status (Enum: online, free, busy, offline)
- max_integration_id (String) # ID в системе MAX

Таблица: orders (Заказы)
- id (UUID, PK)
- client_id (UUID, FK)
- material (String) # Сыпучий материал
- volume (Float)    # Объем
- address (String)  # Адрес доставки
- status (Enum: new, processing, assigning, accepted, in_progress, done, canceled)
- assigned_driver_id (UUID, FK)
- created_at (DateTime)

Таблица: order_offers (Предложения заказов водителям)
- id (UUID, PK)
- order_id (UUID, FK)
- driver_id (UUID, FK)
- status (Enum: pending, accepted, rejected, timeout)
- expires_at (DateTime) # Таймер ответа

Таблица: event_logs (Журнал событий)
- id (UUID, PK)
- order_id (UUID, FK)
- event_type (String) # Например: order_created, driver_assigned
- description (Text)
- created_at (DateTime)

## 3. Хранение файлов
- Временные файлы (парсинг логов/чеков): Локально в контейнере `/tmp/darmavoz_media`
- Постоянное хранилище (аватары, документы, бэкапы БД): Внешнее S3-хранилище (MinIO/AWS S3). В БД хранятся только ссылки (URL) на файлы.