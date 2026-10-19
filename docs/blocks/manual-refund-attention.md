# Внимание логиста: отменённые заказы с невозвращёнными деньгами

Тестовый контур develop. Поздняя клиентская отмена оплаченного заказа сохраняет
Payment и требует ручного решения. Для logist/admin создаются In-app и durable PUSH
с текстом «Заказ #<последние 6 символов ID> отменен клиентом после выезда машины.
Требуется ручное решение по возврату средств!».
Helper refunds.notify_manual_refund_required вызывается при поздней отмене и
подтверждении успешного платежа (в том числе позднего). Неоплаченные отмены,
полностью возвращённые/зарезервированные суммы и автоматический refund intent
уведомление не создают. Стабильный ключ order/operator исключает дубли при
повторе отмены, polling, webhook. Существующие платежи/возвраты helper не меняет.

Order.refundable_amount / requires_manual_refund — read-only SQL-проекции,
без миграций: сумма доступных остатков успешных платежей с вычетом успешных и
зарезервированных Refund. Полностью возвращённый Payment остаётся succeeded,
но не удерживает красный счётчик. cancelled/canceled с доступным остатком >0
требует внимания, включая не удалённые и давно созданные заказы.

GET /api/v1/logist/orders?attention_only=true возвращает все такие заказы
выбранного city_id без лимита обычной страницы. UI запрашивает без фильтра даты.
GET ...?archive=true включает soft-deleted и cancelled/canceled/driver_cancel,
сортирует требующие возврата раньше остальных. Внимание не скрывается датой.
Старые is_deleted/show_deleted сохраняют прежний контракт.

LogistDashboardScreen показывает красный счётчик «Архив» даже на активной вкладке;
объединяет архивную страницу со всеми требующими внимания, выводит их первыми
и показывает жёлтую плашку с доступной суммой. Номер карточки — последние
шесть символов ID, как у клиента и в уведомлении.
Переход из ручного уведомления задаёт refund_attention=1 и city_id,
логист сразу открывает архив и нужную карточку. Неполученные/устаревшие ответы
списка не перезаписывают данные нового города/вкладки.

Ключевые файлы: app/models/commerce.py, schemas/order.py, services/refunds.py,
payments.py, dispatch_service.py, api/clients.py, logist_orders.py;
frontend/src/LogistDashboardScreen.tsx, notificationNavigation.ts.
Проверки: tests/test_refunds.py, frontend/tests/e2e/logist-refund-attention.spec.ts.
Отчёт: ../2026-10-19-manual-refund-attention.md.

Подтверждено на test.darmavoz.ru 19.10.2026, runtime/image 9cc2e8f5: реальный #B6A576 виден logist в архиве с остатком 10 ₽, жёлтой плашкой и красным счётчиком; 390/1440 px. Проверка только GET/SELECT, реальные платежи/отмены/возвраты не запускались. CI backend/frontend и сборка Android — success.

## Возврат прямо из карточки — 19.10.2026

OrderPaymentsPanel содержит общую жёлтую плашку для logist/admin и кнопку «Оформить возврат». Компоненты списков передают requires_manual_refund/refundable_amount и обновляют список после постановки возврата в очередь. OrderRefundModal читает актуальные платежи заказа без синхронизации с ЮKassa, позволяет выбрать подходящий успешный платёж, ввести частичную сумму и обязательную непустую причину, подтвердить действие. Ограничения суммы и серверный RBAC не меняются. Сетевой повтор сохраняет request_id; отправка блокирует повторный клик. Открытие формы не создаёт финансовых операций.

POST /payments/{payment_id}/refund уже разрешён admin/logist через get_current_logist_user; manager/driver/client не получают доступ. Проверки: tests/test_refunds.py::test_refund_creation_staff_roles и frontend/tests/e2e/order-refund-modal.spec.ts (admin/logist, 390/1440 px, невалидные значения, очередь и повтор с тем же ключом). Отчёт: ../2026-10-19-order-refund-button.md.
