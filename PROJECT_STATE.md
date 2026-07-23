# PROJECT STATE - Дармавоз

## 1. Описание проекта

Дармавоз.рф - сервис доставки сыпучих строительных материалов и спецтехники.
Система покрывает клиентский заказ, диспетчеризацию, водительский контур, поставщиков, каталог точек забора и мобильный доступ.

## 2. Актуальный стек

### Backend

- FastAPI
- SQLAlchemy
- Alembic
- Redis
- PostgreSQL

### Frontend / Mobile

- React
- Vite
- Zustand
- Tailwind CSS
- Capacitor

Актуальный мобильный стек проекта: `FastAPI + React + Capacitor`.
Текущий frontend поддерживает web/PWA-сценарий и мобильные сборки через Capacitor.

Папка `mobile/` содержит устаревший Flutter-код (Deprecated).
Она не должна использоваться для новых задач, сборок, CI/CD и развития iOS/Android-контура.

### Инфраструктура

- Docker / Docker Compose
- MinIO
- GitHub Actions
- Firebase Cloud Messaging (FCM)
- SMS.ru
- Caddy

## 3. Основные роли

- Client - оформляет заказ, отслеживает статус и работает с корзиной.
- Driver - принимает и исполняет заказы.
- Admin / Logist - управляют каталогом, ценами, заказами и логистикой.
- Supplier - управляет своими точками забора и материалами.

## 4. Контуры и ветки

### Test contour

- Рабочая ветка: `develop`
- Домен: `test.darmavoz.ru`
- Исходники на сервере: `/opt/darmavoz_test`
- Runtime-контур Docker: `/opt/darmavoz_test_deploy`

### Production contour

- Рабочая ветка: `main`
- Домен: `darmavoz.ru`
- Исходники на сервере: `/opt/darmavoz`
- Runtime-контур Docker: `/opt/darmavoz_deploy`

## 5. CI/CD

GitHub Actions по `develop`:

- деплоит тестовый frontend;
- применяет backend-миграции;
- перезапускает тестовые контейнеры;
- собирает тестовый Android APK.

GitHub Actions по `main`:

- деплоит production frontend;
- применяет production-миграции;
- перезапускает production backend;
- собирает production Android APK.

## 6. Текущее направление

Актуальное развитие мобильного контура идёт через PWA + Capacitor.
Основная цель Sprint 16 - подготовка iPhone-совместимого PWA, подключение Capacitor iOS, единое версионирование и задел под CI/CD сборку `.ipa`.
