# Darmavoz

Актуальная рабочая копия проекта находится в `/opt/darmavoz`.

## Что есть сейчас

- `backend` на FastAPI
- PostgreSQL + Redis
- каталог материалов и вариантов доставки `5/10/17/20/25/30 м3`
- оформление заказа через `POST /api/v1/orders/checkout`
- S3/MinIO для медиа и таблица `media_files`
- React SPA в `frontend/`
- собранный web-клиент в `react_web/`
- Caddy-маршрутизация домена `darmavoz.ru`

## Структура

```text
/opt/darmavoz
├── alembic/
├── app/
│   ├── api/
│   ├── core/
│   ├── db/
│   ├── integrations/
│   ├── models/
│   ├── schemas/
│   ├── security/
│   └── services/
├── frontend/          # исходники React SPA
├── react_web/         # собранный web-клиент для отдачи Caddy
├── scripts/
├── tests/
├── architecture.md
├── darmavoz.caddy
├── docker-compose.local.yml
├── docker-compose.yml
├── full_task.md
├── main.py
└── README.md
```

## Запуск

### Local backend

```bash
docker compose -f docker-compose.local.yml up -d --build
```

### Production services

```bash
docker compose up -d --build
```

`docker-compose.yml` поднимает:

- `backend`
- `minio`

Внешний HTTP(S) терминируется Caddy из DAOOS Kit.

## Frontend

Исходники React-клиента лежат в `frontend/`.

Основные команды:

```bash
cd frontend
npm ci
npm run build
```

Результат сборки публикуется в `frontend/dist/`, а на прод-ноде раздается из `/opt/darmavoz/react_web`.

## Публичные URL

- `https://darmavoz.ru/app` - web-клиент
- `https://darmavoz.ru/api/v1/catalog/categories/`
- `https://darmavoz.ru/api/v1/catalog/materials/`
- `https://darmavoz.ru/api/v1/catalog/delivery-options/`
- `https://darmavoz.ru/api/v1/orders/checkout`
- `https://darmavoz.ru/health`
- `https://darmavoz.ru/docs`

## Ключевые backend endpoints

- `GET /ping`
- `GET /health`
- `POST /api/v1/auth/login`
- `GET /api/v1/catalog/categories/`
- `GET /api/v1/catalog/materials/`
- `GET /api/v1/catalog/delivery-options/`
- `POST /api/v1/orders/checkout`
- `POST /api/v1/media/presign-upload`
- `POST /api/v1/media/confirm`
- `POST /api/v1/webhooks/avito`

## Sprint 7

По фактическому состоянию проекта Sprint 7 закрывает:

- выбор категории и материала
- выбор варианта доставки `5/10/17/20/25/30 м3`
- оформление заказа с адресом и комментарием
- гостевой сценарий без авторизации
- локальную историю заказов на клиенте

## Медиа и S3

- S3-совместимое хранилище: MinIO
- backend-сервис: `app/services/storage.py`
- API медиа: `app/api/media.py`
- метаданные файлов: таблица `media_files`

## Быстрая проверка

```bash
cd /opt/darmavoz
./scripts/smoke_check.sh
```

Smoke-проверка покрывает базовое здоровье backend, login и основные API старших спринтов.
