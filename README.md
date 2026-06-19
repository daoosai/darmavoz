# Darmavoz

Актуальная рабочая копия проекта находится в `/opt/darmavoz`.

## Что есть сейчас

- `backend` на FastAPI
- PostgreSQL + Redis
- каталог материалов и вариантов доставки `5/10/17/20/25/30 м3`
- оформление заказа через `POST /api/v1/orders/checkout`
- S3/MinIO для медиа и таблица `media_files`
- роли `admin` / `logist` / `manager` / `driver`
- автодиспетчеризация и ручное назначение водителя логистом
- профиль водителя и модерация машины/водителя
- логистский список автопарка с presigned preview URL фотографий машины
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
- `GET /api/v1/drivers/`
- `GET /api/v1/logist/orders`
- `POST /api/v1/logist/orders`
- `GET /api/v1/driver/profile`
- `PATCH /api/v1/driver/profile`
- `PATCH /api/v1/driver/vehicle`
- `POST /api/v1/driver/vehicle/submit`
- `GET /api/v1/admin/moderation/pending`
- `POST /api/v1/media/presign-upload`
- `POST /api/v1/media/confirm`
- `POST /api/v1/webhooks/avito`

## Логистский автопарк

Список водителей для вкладки "Автопарк" отдается через `GET /api/v1/drivers/` для ролей `logist` и `admin`.

Ключевые поля ответа:

- `vehicle_main_url` - presigned GET URL главного фото машины
- `vehicle_left_url` - presigned GET URL бокового фото машины
- `vehicle_type`
- `vehicle_cubature_min`
- `vehicle_cubature_max`
- `vehicle_tonnage_min`
- `vehicle_tonnage_max`

Фронтенд для основного превью должен использовать `vehicle_main_url`.

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

Точечная проверка автопарка после backend-правок:

```bash
cd /opt/darmavoz
docker run --rm --entrypoint python --network daoos_kit_default \
  --env-file /opt/darmavoz/.env -v /opt/darmavoz:/app -w /app \
  darmavoz-backend -m pytest tests/test_logist_drivers_api.py -q
```
