# Документация тестового проекта Дармавоз

Рабочий контур: /opt/darmavoz_test, develop, test.darmavoz.ru.
Входные правила: ../AGENTS.md. Документация сверяется с кодом и фактическими проверками; исторические отчёты не заменяют проверку текущего контура.

## Документация по блокам

- [Навигация оптовых заявок](blocks/wholesale-navigation.md).

- [Авторизация](blocks/authentication.md).

- [Логист: водители и автопарк](blocks/logist-drivers.md) — назначение, API, карточки, фильтры, изменение Push-индикатора, проверки и ограничения.

При работе с новым блоком создавать или обновлять отдельный документ в blocks/: назначение, что реализовано и как работает, ключевые файлы/API, изменения, проверки и известная оставшаяся работа. Непроверенное отмечать явно. Отчёты отдельных задач хранить отдельно со ссылкой на блок.

## Спринты и отчёты

- [Спринт 22](sprint22.md).
- [Спринт 24](sprint24.md).
- [Реализация спринта 25](SPRINT_25_IMPLEMENTATION.md).
- [Порядок работы агента](2026-10-02-agent-workflow.md).
- [Удаление Push-индикатора логиста](2026-10-02-logist-driver-push.md).

- [Hotfix авторизации](2026-10-02-auth-hotfix.md).

- [Исправление навигации опта](2026-10-02-wholesale-navigation.md).

- [Видимость опта по ролям](2026-10-02-wholesale-role-visibility.md).

- [Доступ к оптовым заявкам без whitelist](2026-10-02-wholesale-access.md).

- [Модерация оптовых заявок и PUSH](2026-10-02-wholesale-moderation.md).

- [UX формы оптовых заявок и layout](2026-10-02-wholesale-form-layout.md)

- [Необязательное количество машин и общая карточка](2026-10-02-wholesale-optional-count-card.md)

- [Админская навигация и уведомления оптовых заявок](2026-10-02-wholesale-admin-navigation-notifications.md)

- [Админская модерация и черновики опта](2026-10-02-wholesale-admin-view-drafts.md)

- [Интерфейс опта для водителя](2026-10-02-wholesale-driver-view.md)

- [Все собственные заявки поставщика](2026-10-02-wholesale-supplier-all.md)

- [Допуск водителя к опту после модерации](2026-10-02-wholesale-driver-access.md)

- [Спринт 25: городской фильтр оптовой модерации и автотесты](blocks/sprint25-wholesale-city-tests.md).
- [Отложенные старые тесты вне спринтов 24–25](2026-10-05-deferred-legacy-tests.md).
- [Отчёт исправления фильтра и тестов спринтов 24–25](2026-10-05-sprint25-city-tests-fix.md).

- [HTTPS и Caddy](blocks/https-caddy.md).
- [Восстановление HTTPS 10.10.2026](2026-10-10-https-recovery.md).

- [Адреса клиента](blocks/client-addresses.md).
- [Расследование сохранения адресов 11.10.2026](2026-10-11-client-address-saving.md).

- [Подбор точек в корзине](blocks/cart-pickup-point-validation.md).
- [Аудит Лесного песка 11.10.2026](2026-10-11-forest-sand-cart-audit.md).

- [Клиент ЮKassa](blocks/payment-review-client.md).
- [Whitelist и доставка 12.10.2026](2026-10-12-payment-review-client.md).

- [Клиентская карта по геолокации](blocks/client-map.md) — [исправление и проверки 12.10.2026](2026-10-12-client-map-geolocation.md).

- [Версии и публикация APK](blocks/app-releases.md) — [выпуск 12.10.2026](2026-10-12-apk-release.md).

- [Пригороды в корзине и приоритет адреса карты](2026-10-12-suburbs-cart-map.md).

- [12.10.2026 — точечный перенос пригородной корзины и карты на production](2026-10-12-suburbs-production.md)

- [14.10.2026 — production обновления через Google Play](2026-10-14-production-update-google-play.md)

- [14.10.2026 — живая проверка тестовой ЮKassa](2026-10-14-yookassa-live-e2e.md)
- [Оплата и проверка платежей](blocks/payments.md)

- [Клиентские заказы](blocks/client-orders.md)
- [14.10.2026 — карточка заказа: оплата, фото и прокрутка](2026-10-14-client-order-card.md)

- [Административные точки](blocks/admin-points.md)
- [14.10.2026 — исправление HTTP 500 точек и старых заказов](2026-10-14-admin-points-server-error.md)

- [Видимость отключённых водителей — 14.10.2026](2026-10-14-driver-account-visibility.md)

- [Отказ назначения Ивана Ивана Степановича — 14.10.2026](2026-10-14-stepanovich-assignment-audit.md)
