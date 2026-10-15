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
пересоздания backend. Файлы .env не меняются.

Результаты lint, commit/push develop/main, merge, доставки и проверки версий
будут дополнены по фактическому завершению релиза.

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
