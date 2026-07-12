# Архитектура и Правила для AI-Агентов (Кодекс)

## 1. Локальное рабочее пространство (Local Workspace)
Проект разделен на две физические папки для безопасности:
- `darmavoz_deploy` — локальная копия Production (ветка `main`).
- `darmavoz_test` — локальная копия Staging (ветка `develop`).

Все новые фичи, багфиксы, эксперименты и проверка изменений выполняются строго в папке `darmavoz_test`.

## 2. Доступ к серверу
- SSH подключение: `ssh root@159.194.236.11`
- Боевой домен: `https://darmavoz.ru`
- Тестовый домен (Песочница): `https://test.darmavoz.ru`

## 3. Структура директорий на сервере (Git Worktree)
Сервер использует архитектуру Zero-Downtime Deployment через Git Worktrees.
- `/opt/darmavoz` — исходники Production (ветка `main`). Сюда GitHub Actions доставляет и обновляет код.
- `/opt/darmavoz_deploy` — боевой Runtime. Отсюда запущены боевые контейнеры `darmavoz_backend` и `minio`. Прямые правки запрещены.
- `/opt/darmavoz_test` — исходники Staging (ветка `develop`). Сюда GitHub Actions доставляет и обновляет код.
- `/opt/darmavoz_test_deploy` — тестовый Runtime. Отсюда запущены `backend_test`, `db_test`, `minio_test`. Прямые правки запрещены.

## 4. Базы данных и Тома (Volumes)
- Данные боевого MinIO: bind mount в `/opt/minio/data`
- Данные тестовых БД и MinIO: лежат в Docker-томах `/var/lib/docker/volumes/darmavoz_test_deploy_...`

## 5. CI/CD (GitHub Actions)
Мы используем строгий GitFlow:
- Ветка `develop` -> деплоится на `test.darmavoz.ru`, собирает тестовый фронтенд и `darmavoz-test.apk`.
- Ветка `main` -> деплоится на `darmavoz.ru`, собирает боевой фронтенд и боевой APK.

Важно:
- GitHub Actions уже настроен на сборку APK и фронтенда.
- На ноде Дармавоза не нужно вручную собирать фронтенд через Node.js, если нет отдельного экстренного сценария.
- Стандартный путь доставки изменений: `git push` -> GitHub Actions -> обновление исходников на сервере -> перезапуск нужных контейнеров.

## 6. Правила работы Агента
1. Вся разработка ведется в `darmavoz_test` (ветка `develop`).
2. После проверки кода делай `git add .`, затем `git commit` и `git push origin develop` из папки `darmavoz_test`.
3. GitHub Actions сам скачает код на сервер, соберет фронтенд и APK, затем перезапустит нужные контейнеры.
4. Вносить правки напрямую на сервере через SSH можно только в экстренных случаях (Hotfix), после чего обязательно нужно синхронизировать изменения обратно и сделать push на GitHub.
5. Папки `/opt/darmavoz_deploy` и `/opt/darmavoz_test_deploy` считаются runtime-каталогами. Редактирование файлов внутри них запрещено.
