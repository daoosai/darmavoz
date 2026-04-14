# Архитектура проекта "Дармавоз.рф" (Core API)

## 1. Общая структура проекта (Monorepo)
Проект использует подход монорепозитория. Бэкенд и Фронтенд изолированы, но находятся в едином пространстве для удобства CI/CD и контекста ИИ.

/ (Корень репозитория)
├── /backend                  # Серверная часть (Python, FastAPI)
│   ├── /app
│   │   ├── /api              # Эндпоинты (роуты) API
│   │   ├── /core             # Настройки, конфигурация, безопасность
│   │   ├── /db               # Подключение к БД и миграции (Alembic)
│   │   ├── /models           # ORM модели базы данных
│   │   ├── /schemas          # Pydantic схемы валидации
│   │   └── /services         # Бизнес-логика, ИИ-модуль, интеграция Avito/MAX
│   ├── Dockerfile
│   ├── requirements.txt
│   └── main.py
│
├── /frontend                 # Клиентская часть (React, TypeScript, Vite)
│   ├── /public               # Статические ассеты (иконки, картинки)
│   ├── /src
│   │   ├── /components       # Общие UI компоненты (кнопки, карточки)
│   │   ├── /pages            # Страницы (Панель логиста, Аналитика)
│   │   ├── /services         # Запросы к Backend API (axios/fetch)
│   │   ├── /store            # Управление состоянием (Zustand/Redux)
│   │   ├── App.tsx           # Главный компонент фронтенда
│   │   └── main.tsx          # Точка входа
│   ├── Dockerfile
│   ├── package.json
│   └── vite.config.ts
│
├── .github/workflows/        # CI/CD Пайплайны (Автодеплой)
├── docker-compose.yml        # Оркестрация контейнеров (Бэк + Фронт + БД)
├── architecture.md           # Этот файл (архитектура и БД)
├── flows.md                  # Описание бизнес-сценариев
└── README.md                 # Общая инструкция по запуску
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