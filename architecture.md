# Архитектура Darmavoz

Документ фиксирует текущее рабочее состояние backend и web-клиента на ноде `дармавоз` в каталоге `/opt/darmavoz`.

## 1. Состав системы

Проект состоит из четырех основных частей:

- FastAPI backend
- PostgreSQL / Redis
- React SPA
- MinIO + Caddy-инфраструктура

В текущем контуре дополнительно активно используются:

- логистский контур заказов и автопарка
- driver onboarding и модерация профилей/машин
- dispatch worker для автоматического подбора водителя

## 2. Структура репозитория

```text
/opt/darmavoz
├── alembic/
├── app/
│   ├── api/
│   │   ├── admin.py
│   │   ├── auth.py
│   │   ├── catalog.py
│   │   ├── clients.py
│   │   ├── drivers.py
│   │   ├── media.py
│   │   ├── orders.py
│   │   └── webhooks.py
│   ├── core/
│   ├── db/
│   ├── integrations/
│   ├── models/
│   ├── schemas/
│   ├── security/
│   └── services/
├── frontend/          # исходники React SPA
├── react_web/         # собранный frontend для раздачи на домене
├── scripts/
├── tests/
├── docker-compose.local.yml
├── docker-compose.yml
├── darmavoz.caddy
└── main.py
```

## 3. Runtime topology

### Local

`docker-compose.local.yml` поднимает локальный backend-контур:

- `db`
- `redis`
- `backend`

### Production

`docker-compose.yml` поднимает:

- `backend`
- `minio`

Особенности production:

- backend подключен к внешней сети `daoos_kit_default`
- наружу backend не публикуется, используется `expose: 8000`
- домен обслуживается внешним Caddy
- собранный frontend отдается как статический сайт

## 4. HTTP-маршрутизация

На домене `darmavoz.ru` используются два типа трафика:

- API-запросы к FastAPI
- статическая раздача React SPA

Репозиторный конфиг `darmavoz.caddy` описывает:

- `/s3/*` -> proxy в MinIO
- `/static/*` -> файловая раздача
- `/assets/*` -> статические frontend assets
- `/app*` -> SPA entrypoint из `/opt/darmavoz/react_web`
- остальной backend traffic -> `darmavoz_backend:8000`

На live-контуре Caddy внутри DAOOS Kit использует bind-mount `/opt/darmavoz -> /srv/darmavoz`, поэтому внутри контейнера корень frontend выглядит как `/srv/darmavoz/react_web`.

## 5. Backend

Точка входа: `main.py`

Подключенные роутеры:

- `/api/v1/auth`
- `/api/v1/admin`
- `/api/v1/catalog`
- `/api/v1/clients`
- `/api/v1/drivers`
- `/api/v1/logist`
- `/api/v1/driver`
- `/api/v1/media`
- `/api/v1/orders`
- `/api/v1/system`
- `/api/v1/webhooks`

Сервисные endpoints:

- `GET /`
- `GET /ping`
- `GET /health`

## 6. Каталог, логистика и водительский контур

Каталог и логистический контур опираются на следующие сущности:

- `categories`
- `materials`
- `delivery_options`
- `orders`
- `order_items`
- `drivers`
- `vehicles`
- `order_offers`
- `media_files`

Backend отдает:

- категории материалов
- материалы
- варианты доставки `5/10/17/20/25/30 м3`
- checkout заказа

`app/api/catalog.py` прикладывает к материалам активные варианты доставки и связанные media-файлы.

`app/api/orders.py` создает заказ через `POST /api/v1/orders/checkout`, включая:

- выбранный материал
- `delivery_option_id`
- адрес
- комментарий
- гостевой сценарий без обязательной авторизации клиента

`app/api/logist_orders.py` и `app/services/dispatch_service.py` покрывают:

- создание заказа логистом
- просмотр заказов логистом
- ручное назначение водителя
- перезапуск диспетчеризации
- историю попыток назначения

`app/api/drivers.py` отдает список автопарка для логиста через `GET /api/v1/drivers/`.

Для списка водителей используется схема `DriverFleetResponse`, в которой дополнительно отдаются:

- `vehicle_main_url`
- `vehicle_left_url`
- `vehicle_type`
- `vehicle_cubature_min`
- `vehicle_cubature_max`
- `vehicle_tonnage_min`
- `vehicle_tonnage_max`

`vehicle_main_url` и `vehicle_left_url` формируются как presigned GET URL через `app/services/storage.py` по данным `media_files` для `slot_key=vehicle_main|vehicle_left`.

## 7. Медиа и S3

Файлы изображений обслуживаются через MinIO.

Основные компоненты:

- конфигурация: `app/core/config.py`
- storage service: `app/services/storage.py`
- API: `app/api/media.py`
- ORM-модель: `MediaFile`
- таблица БД: `media_files`

Поддерживаются сущности:

- `material`
- `delivery_option`
- `order`
- `vehicle`

## 8. Frontend

Frontend реализован как React SPA.

Ключевые части:

- `frontend/src/LogistDashboardScreen.tsx` - вкладки логиста, заказы и автопарк
- `frontend/src/AdminDashboardScreen.tsx` - админка и модерация
- `frontend/src/DriverProfileScreen.tsx` - профиль и машина водителя
- `frontend/src/DriverOrdersScreen.tsx` - экран водителя
- `frontend/src/store.ts` - Zustand store авторизации и клиентской корзины
- `frontend/src/utils.ts` - `baseURL` и helper-функции

Текущий пользовательский путь:

1. Выбор категории
2. Выбор материала
3. Выбор кубатуры машины
4. Добавление в корзину
5. Ввод адреса
6. Checkout
7. Сохранение истории в `localStorage`

Отдельно для логиста:

1. Просмотр списка заказов
2. Просмотр вкладки "Автопарк"
3. Получение списка водителей из `GET /api/v1/drivers/`
4. Использование `vehicle_main_url` для превью машины
5. Ручное назначение водителя на заказ

## 9. CI/CD

GitHub Actions workflow: `.github/workflows/deploy.yml`

Пайплайн:

1. checkout репозитория
2. `npm ci` в `frontend/`
3. `npm run build`
4. upload `frontend/dist/` на сервер по SSH

## 10. Ограничения текущего состояния

- часть документации по ранним спринтам и legacy demo-маршрутам еще остается в репозитории
- `GET /api/v1/drivers/` смонтирован вне `/api/v1/logist`, что важно учитывать фронтенду и документации
- список автопарка использует presigned URL, поэтому превью зависят от корректной S3-конфигурации
- история заказов на клиентском контуре частично остается гостевой, через `localStorage`

## 11. Актуальность размещений

Точки забора и объявления спецтехники имеют независимые `moderation_status` и `placement_status`. Первый отвечает за проверку контента, второй — за право публичного показа.

Единый relevance service управляет тестовым периодом, окончанием размещения, подтверждением актуальности, ручным скрытием, архивом и продлением. Публичные SQL-запросы дополнительно проверяют даты, поэтому просроченная сущность не отображается даже при задержке фонового worker.

Периоды trial, продления, подтверждения, grace и интервал worker задаются только backend-переменными окружения.
