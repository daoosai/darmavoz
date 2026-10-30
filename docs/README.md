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

- [Карточка клиента: порядок блоков и приоритет оплаты — 14.10.2026](2026-10-14-client-order-layout-payment.md)

- [Результат оплаты: статусы и автоматический возврат — 14.10.2026](2026-10-14-payment-return-ux.md)

- [Начальный статус клиента до проверки логистом — 14.10.2026](2026-10-14-client-initial-status.md)

- [Смена водителя и назначенные заказы](blocks/driver-shifts-orders.md) — [исправление Web 14.10.2026](2026-10-14-driver-shift-orders.md).

- [Клиентская карточка: «Едет к вам» и иконка обновления оплаты — 14.10.2026](2026-10-14-client-card-status-refresh.md).

- [Восстановление загрузки клиентской карты — 14.10.2026](2026-10-14-map-recovery.md).

- [Реестр заказов администратора](blocks/admin-orders.md) — [полное удаление 14.10.2026](2026-10-14-admin-order-hard-delete.md).

- [Возвраты ЮKassa: очередь, частичные суммы, webhook](blocks/refunds.md); [отчёт реализации](2026-10-14-yookassa-refunds.md).

- [Экстренный релиз 3.1.7 (387), develop → main](2026-10-15-emergency-release-3.1.7.md).

- [16.10.2026 — общий E2E-аудит и безопасность](2026-10-16-general-e2e-security-audit.md)

- [Блок: диагностический E2E-аудит и безопасность](blocks/security-e2e-audit.md)

- [16.10.2026 — утверждённый план устранения аудита](2026-10-16-audit-remediation-plan.md)

- [16.10.2026 — реализация Security & Bugfix](2026-10-16-security-bugfix.md)

- [Блок: безопасные зависимости](blocks/security-dependencies.md)

- [Корзина: ручной выбор точки после ошибки — 16.10.2026](2026-10-16-cart-pickup-fallback.md).

- [Клиентские возвраты и соглашение — 16.10.2026](2026-10-16-refund-client-terms.md); [правила отмены](blocks/legal-terms.md).

- [Клиентская отмена до загрузки и ручной возврат — 19.10.2026](2026-10-19-client-late-cancellation.md).

- [Внимание логиста: ручные возвраты — 19.10.2026](2026-10-19-manual-refund-attention.md); [блок](blocks/manual-refund-attention.md).

- [Возврат из карточки логиста/admin — 19.10.2026](2026-10-19-order-refund-button.md).

- [Полный production-релиз 3.3.2 (320) — 20.10.2026](2026-10-20-release-3.3.2.md).

- [Google Play: versionCode 390 при версии 3.3.2 — 20.10.2026](2026-10-20-versioncode-390.md).

- [3.3.3 (391): смена ключа 2GIS и пересоздание backend — 22.10.2026](2026-10-22-release-3.3.3-2gis.md).

- [Спринт 26 — план](sprint26-plan.md), [прогресс](sprint26-progress.md), [блок](blocks/sprint26.md).

- [Спринт 26 — единый план, состояние и передача работы](SPRINT_26.md)
