# Выпуск APK — 12.10.2026

Пользователь подтвердил работу клиентской карты и явно поручил повысить версии обоих контуров и серверного .env. Полное слияние веток запрещено: спринты develop ещё не приняты.

Тест: package 3.3.5 / code 323 → 3.3.6 / code 324. Production: 3.1.5 / code 316 → 3.1.6 / code 317. В каждой ветке отдельно изменены package.json, корневые версии package-lock.json, Android fallback и метаданные iOS штатным version:sync. Код функций и спринтов при этом не переносится. IOS_VERSION серверного .env не повышается: задача касается APK и веба, новый iOS-релиз не выполняется.

ANDROID_VERSION и WEB_VERSION .env синхронизируются с APK своего контура после публикации APK. Runtime .env — ссылки на /opt/darmavoz_test/.env и /opt/darmavoz/.env; перед правкой создаётся резервная копия. Другие переменные не изменяются. До публикации нового APK сервер не объявляет его доступным.

Проверки: тестовый npm run lint/build прошли. Production npm ci, npm run lint и npm run build прошли; npm ci потребовался для установки актуальных зависимостей в изолированном рабочем дереве. Изначальная production APK подтверждена скачиванием: ru.darmavoz.app, 3.1.5 (316), содержит исправление геокарты.

## Итог
- develop commit bc6a28ba, main commit 6498e0d8: отдельные повышения версии, push успешны. В diff каждого коммита только пять файлов версии и три документа; app/, frontend/src/, alembic/, .github/ не изменены. Полного merge нет, непроверенные спринты в main не перенесены.
- Test APK/AAB workflow 38224447191 и deploy-test 38224447203 — success. Runtime bc6a28ba.
- Production APK/AAB workflow 38224571661 и deploy-prod 38224985515 — success. Runtime 6498e0d8. Для применения .env после CI production backend отдельно пересоздан через compose up --no-deps --force-recreate backend; пересборка логики не требовалась.
- APK скачаны по внешним URL, распакованы и проверены по бинарному AndroidManifest.xml: тест ru.darmavoz.app.test, versionName 3.3.6, versionCode 324; production ru.darmavoz.app, 3.1.6, 317. В обоих APK есть новая геокарта и правильный API origin. Подпись production release проверяет apksigner в CI, AAB доступны в артефактах workflow.
- GET /api/v1/system/version: test android/web 3.3.6, production 3.1.6. Health online у обоих. Публичные web JS содержат новые версии.
- .env: проверено сравнение с резервной копией — изменены только ANDROID_VERSION и WEB_VERSION. Резервные копии в /root/darmavoz-recovery/20261012-apk-release (каталог 0700, файлы 0600). Runtime-ссылки .env сохранены. IOS_VERSION остаётся 3.1.5, iOS-релиз не выполнялся.
- Метаданные APK и живого API: reports/2026-10-12-apk-release/test-apk.json, production-apk.json, live-versions.json. Установка на физическое устройство не выполнялась; пользователь может проверить обновление APK. Публикация в магазинах не входила в задачу, APK и AAB подготовлены.

Скачать: https://test.darmavoz.ru/static/darmavoz-test.apk?v=3.3.6 и https://darmavoz.ru/static/darmavoz.apk?v=3.1.6.
