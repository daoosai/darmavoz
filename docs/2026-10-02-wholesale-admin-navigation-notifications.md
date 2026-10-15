# Навигация админа, уведомления pending и карточка
Контур: develop, /opt/darmavoz_test, test.darmavoz.ru/app.

Админ: sidebar/drawer «Оптовые заявки» с Briefcase ведёт /admin/wholesale.
Маршрут зарегистрирован в App и ADMIN_TAB_PATHS, открывает WholesaleScreen
с initialView moderation. Перезагрузка URL сохраняет раздел.
Существующий переход из общей «Модерации» сохранён. Старые ссылки
/admin/moderation?notification_wholesale также открывают оптовую карточку.

При POST, PUT и повторном submit отклонённой заявки статус/event pending
и уведомления активным неудалённым admin записываются в одной транзакции.
Используется enqueue Спринта 25: UserNotification + PushDelivery, FCM User.fcm_token.
Автор-admin сам себя не уведомляет; logist и неактивные/удалённые исключены.
Dedupe по event_id/admin_id. Legacy submit для уже pending идемпотентен.
Сохранение исправлений создаёт новое событие и новое уведомление.
Старые PUSH отменяются штатной проверкой версии события/status.
Уведомление содержит wholesale_request_id; клики inbox/PUSH админа ведут
/admin/wholesale?notification_wholesale=id и автоматически открывают детали.
Начальная лента админа при таком переходе остаётся moderation, а не mine.

WholesaleRequestCard учитывает is_owner: контактные данные показаны,
но звонок/копирование самому себе скрыты и в списке, и в деталях.
Preview по-прежнему не запускает звонок. «Подробнее» и «Редактировать»
разнесены в flex-wrap justify-between с gap-4 и верхним отступом.
Маршрут использует formatShortAddress для обеих точек; полные адреса
в БД/форме остаются для редактирования, маска телефона сохранена.

Файлы: app/api/wholesale.py; frontend/src/AdminDashboardScreen.tsx,
App.tsx, notificationNavigation.ts, WholesaleScreen.tsx, WholesaleRequestCard.tsx.
Тесты: активные admin получают inbox/outbox, inactive/deleted/logist не получают,
FCM имитирован транспортом, повтор submit не дублирует событие,
исправление снова уведомляет, старое событие перестаёт быть актуальным.
E2E: sidebar 390/1440 + reload, admin inbox deep link, свои контакты скрыты,
сокращённые адреса и разделённые действия; регрессия полного цикла модерации.
Локально: 52 backend-теста прошли; lint и build прошли.
В полном E2E-запуске 27 passed; три проверки admin/catalog сначала не прошли
из-за неполного мока /admin/placements/summary. После исправления структуры
ответа 4 адресные проверки навигации/deep link/карточки прошли (30 разных сценариев).
Доставка выполняется штатным CI; итоговые commit/runtime/CI/live-сценарий
фиксируются в node-local артефакте docs/reports/wholesale-admin-live.json.
Физический PUSH требует зарегистрированного устройства; inbox проверяется в браузере.
.env, версии и production не меняются.
