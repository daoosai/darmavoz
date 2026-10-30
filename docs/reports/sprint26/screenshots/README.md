# Контрольные снимки Спринта 26

Размеры: **360×800,390×844,768×1024,1024×768,1440×900,844×390**; короткий viewport390×420 для поля чата/отзыва. Это браузерные снимки, не доказательство работы на физическом телефоне.

Всего **182 PNG**; размеры и SHA256 каждого файла — [manifest](manifest.json). В таблице представлены контрольные примеры; остальные размеры доступны по тому же префиксу имени.

| Экран | Телефон | Другой размер/состояние |
| --- | --- | --- |
| Подписки поставщика | [supplier-subscriptions-390.png](supplier-subscriptions-390.png) | [supplier-subscriptions-844.png](supplier-subscriptions-844.png) |
| Вода/септики и спецтехника | [water_septic_partner-subscriptions-390.png](water_septic_partner-subscriptions-390.png) | [equipment_owner-subscriptions-390.png](equipment_owner-subscriptions-390.png) |
| Админ: платежи и тарифы | [admin-subscription-payments-360.png](admin-subscription-payments-360.png) | [admin-plan-form-390.png](admin-plan-form-390.png) |
| Админ: доступ/споры | [admin-manual-access-360.png](admin-manual-access-360.png) | [admin-manual-access-844.png](admin-manual-access-844.png) |
| Админ: переход/журнал | [admin-legacy-transition-390.png](admin-legacy-transition-390.png) | [admin-subscription-audit-360.png](admin-subscription-audit-360.png) |
| Админ: настройки/аналитика | [admin-subscription-settings-360.png](admin-subscription-settings-360.png) | [admin-journeys-390.png](admin-journeys-390.png) |
| Чат и короткий viewport | [general-chat-360.png](general-chat-360.png) | [chat-short-keyboard-viewport-390.png](chat-short-keyboard-viewport-390.png) |
| Модерация и expiry | [chat-moderation-390.png](chat-moderation-390.png) | [chat-expired-390.png](chat-expired-390.png) |
| Форма платной воды | [paid-water-form-390.png](paid-water-form-390.png) | [paid-water-form-844.png](paid-water-form-844.png) |
| Published notice водителя | [live-driver-subscription-notice-360.png](live-driver-subscription-notice-360.png) | [live-driver-subscription-notice-844.png](live-driver-subscription-notice-844.png) |
| Published SDK карта | [live-public-map-materials-390.png](live-public-map-materials-390.png) | [live-public-map-materials-844.png](live-public-map-materials-844.png) |
| Карточка накопителя | [live-public-point-card-storage-360.png](live-public-point-card-storage-360.png) | [live-public-point-card-storage-844.png](live-public-point-card-storage-844.png) |
| Карточка воды | [live-public-point-card-water-390.png](live-public-point-card-water-390.png) | [live-public-point-card-water-844.png](live-public-point-card-water-844.png) |
| Карточка септика | [live-public-point-card-septic-390.png](live-public-point-card-septic-390.png) | [live-public-point-card-septic-844.png](live-public-point-card-septic-844.png) |
| Published chat/история | [live-general-chat-390.png](live-general-chat-390.png) | [live-journey-verified-history-390.png](live-journey-verified-history-390.png) |
| Owner и получение/отзыв | [live-owner-notification-target-390.png](live-owner-notification-target-390.png) | [live-client-receipt-review-390.png](live-client-receipt-review-390.png) |
| Технический возврат подписки | [live-subscription-refund-form-390.png](live-subscription-refund-form-390.png) | [live-subscription-refund-form-844.png](live-subscription-refund-form-844.png) |

`live-driver-subscription-notice-*`, `live-public-map-*`, `live-public-point-card-*` — **42 снимка опубликованного c3a8a294** с реальным SDK 2GIS. Проверены отсутствие legacy free-water фильтра, границы карточек, прокрутка до контакта, получение pointer events close/route/contact и доступность sticky close без автоматической прокрутки обратно. Layout marker activation для material/water выполнялась программным событием; это не доказательство попадания пальцем в маркер на телефоне. QA septic выбран обычным кликом из списка.

Основные admin/subscription/chat/water-form снимки получены из opt-in тестов на изолированной QA БД. Дополнительный admin case проверил access/transition/audit на6размерах. `driver-public-map-*` показывает также fallback при отсутствии ключа в изолированном окружении; SDK tiles оцениваются по published `live-public-map-*`. Другие `live-*` относятся к отдельным сценариям в [отчёте выпуска](../TEST_RELEASE.md), часть записана на предыдущей49сборке неизменившихся возможностей. Ранние `qa-admin-*` — дополнительные иллюстрации, не подтверждение последнего deploy.

Выполнен ручной просмотр примеров каждого нового экрана и затронутых карточек на нескольких размерах; автоматические проверки охватывают все заданные размеры. Сохранён действующий визуальный стиль. Исправлены контраст кнопки, слои/позиция SDK, landscape и прокрутка sheets. Browser snapshots не подтверждают Android inset/клавиатуру/PUSH. В кадрах используются QA данные; provider inspection images хранятся приватно вне Git.
