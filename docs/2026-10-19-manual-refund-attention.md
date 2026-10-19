# Внимание логиста при ручных возвратах — 19.10.2026

Контур develop /opt/darmavoz_test, test.darmavoz.ru.
Причина пропажи #B6A576: архив запрашивал только is_deleted=true, тогда как
клиентская отмена сохраняет is_deleted=false. Терминальный заказ скрывался
из Активных и не попадал в старый архив.

Реальный заказ e94e7324-3853-41c9-b2c9-eca244b6a576 проверен только чтением:
cancelled, is_deleted=false, cancelled_by_type=client; Payment succeeded 10 ₽,
auto_refund_requested=false, needs_review=true, Refund отсутствует.
Новая SQL-проекция на настоящей тестовой БД чтением подтвердила:
refundable_amount=10.00, requires_manual_refund=true.
Заказ/платёж/возвраты не изменялись; повтор отмены или возврат не запускались.

Добавлены точное уведомление для активных logist/admin через durable outbox,
защита от повторов и поздней оплаты; красный счётчик на архиве, жёлтая плашка,
приоритет старых заказов с доступным возвратом, архив клиентских отмен без удаления.
Счётчик независим от даты/20 записей обычной страницы, учитывает город,
не считает полностью возвращённые деньги, даже если Payment всё ещё succeeded.
Финансовые операции и refund intent не меняются. Миграций/.env/версий/production нет.

Подробности: blocks/manual-refund-attention.md; блок возвратов blocks/refunds.md.
Проверки/коммит/CI/доставка и видимость реального заказа фиксируются после выполнения.

Локальные проверки на ноде: npm run lint — PASS; tests/test_refunds.py — 44 passed (изолированная БД/mock provider); Playwright logist-refund-attention + refunds — 8 passed, 390/1440 px. git diff --check — PASS.
