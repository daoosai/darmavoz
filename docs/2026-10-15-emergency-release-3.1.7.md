# Экстренный релиз 3.1.7 (387), 15.10.2026

Явное поручение владельца: установить 3.1.7 / Android 387, затем полностью
слить develop в main и доставить все изменения, включая возвраты ЮKassa.
Версии в серверных .env обновлены владельцем. Позднее владелец отдельно поручил перенести только платёжные настройки test → production; это разрешённое исключение первоначального запрета.

Обновляются package.json, корневые версии package-lock, Android fallback,
iOS Info.plist и обе конфигурации Xcode. Источник синхронизации — package.json.

Production merge выполняется в /opt/darmavoz (main); /opt/darmavoz_deploy —
runtime worktree, который обновляет workflow. Обе рабочие копии были чистыми.
Чужие audit-документы и изменения docs/README в test сохраняются вне коммита.

Устранён случай пустого production Git bundle при совпадении HEAD исходников
с SHA релиза: передаётся последний коммит с имеющимся на сервере родителем.
Runtime обновляется только при чистом дереве, без reset --hard.
Backend получает label commit, миграция выполняется одним процессом до
пересоздания backend. Платёжные ключи .env перенесены позднее по отдельному поручению владельца; версии .env исправлял владелец.

Коммиты и результаты доставки приведены ниже.

Перед коммитом npm run version:sync и npm run lint прошли. В production .env ANDROID_VERSION/IOS_VERSION/WEB_VERSION=3.1.7. В test ANDROID_VERSION/WEB_VERSION=3.3.7, IOS_VERSION=3.1.7 — требуется ручная корректировка владельцем, env не изменялся.


## Объединение миграций

Первый production-deploy 38671403747 остановился до применения миграций:
в prod транспортная ревизия исторически следует за de1cd3718448, а в staging
шла до неё. Автоматическое слияние сохранило production-предков, образовав два head.
До исправления старый production-контейнер восстановлен, /health снова 200.
Production-предки сохранены и синхронизированы в develop, добавлена пустая merge
revision release_317_merge_heads. Транспортная миграция сохраняет существующую
полную схему staging; данные/таблицы не удаляются и не пересоздаются.
Тесты проверяют единственный head и сохранение ID транспортных категорий при
переходе со staging-маркера refunds_durable_queue.

Владелец исправил версии test.env на 3.1.7; backend_test пересоздан, API всех
платформ отвечает 3.1.7. Оба APK проверены по бинарному AndroidManifest:
versionName 3.1.7, versionCode 387.

93 адресных теста миграций/платежей/возвратов прошли на объединённой истории.
По отдельному поручению production.env получил тестовый shop/key из test.env,
PAYMENTS_ENABLED=true, PAYMENT_TEST_MODE=true, PAYMENT_RETURN_URL=https://darmavoz.ru/app.
Проверены test_ prefix и сохранение всех неплатёжных значений. Секреты не выводились
и не коммитятся. Приватная резервная копия env находится вне репозитория на ноде.
Для Basic Auth HTTP-уведомления настраиваются в кабинете ЮKassa; автоматическое
изменение чужого HTTP-URL магазина не выполнялось. Worker поддерживает сверку
статусов без webhook; production URL обработчика /api/v1/webhooks/yookassa.

## Фактическая поставка и проверка

- Возвраты: 772f5248; исправление desktop-формы: 6672daec.
- Версия: e025d018, develop; первое полное слияние main: ee9cdefe.
- Единая история миграций: 6574b633, develop; полное слияние main: 6da4d1f6.
  Все коммиты отправлены в origin без force push.
- Production восстановлен на новом image 6da4d1f6: backend собран с
  APP_BUILD_COMMIT, остановлен перед отдельным alembic upgrade head и пересоздан.
  Миграции применены успешно; текущая ревизия release_317_merge_heads.
- Внешние /health и /app обоих контуров — 200. API version: Android/iOS/Web
  3.1.7, force_update=false. APK обоих контуров: 3.1.7 / 387.
- Браузерная проверка обоих доменов на 390px: приложение загружается,
  фактически отданный JS содержит 3.1.7, pageerror=0.
  Артефакты: docs/reports/2026-10-15-emergency-release-3.1.7/.

## Тестовая оплата на production

Публичные секреты не выводились, в Git их нет. Проверен реально работающий
production backend: shop/key настроены, PAYMENT_TEST_MODE=true, ключ тестовый,
PAYMENT_RETURN_URL=https://darmavoz.ru/app, receipts_enabled=true.
Авторизованный GET существующего sandbox-платежа в ЮKassa успешен:
test=true, recipient.account_id совпадает с настроенным shop.
GET /api/v1/payments/config с авторизацией возвращает enabled=true,
test_mode=true, receipts_enabled=true. В опубликованной OpenAPI есть маршрут
возврата с обязательным request_id.

Новый платёж/возврат на production в этой проверке НЕ создавался.
Сквозной checkout → sandbox payment → разрешённая отмена → refund остаётся
QA-приёмкой. Реальная доставка webhook из кабинета ЮKassa не подтверждена;
его адрес указан выше, worker выполняет фоновую сверку.
Сборка APK/AAB и публикация серверного APK выполнены; загрузка в Google Play
не входит в этот релиз и не выполнялась.

## Завершение GitHub Actions

- develop 6574b633: Deploy Test 38672047344 — success (проверки и доставка);
  Build Test Android APK 38672047381 — success.
- main 6da4d1f6: Build Android APK 38672264983 — success;
  Deploy Production 38672487608 — success.
  workflow_run использует workflow из default branch (в API run head_sha может
  показывать 6574b633), но source/runtime/image production проверены на 6da4d1f6.
- Оба runtime/image соответствуют коммитам приложения; документационная
  фиксация результата отдельно не требует пересборки.
