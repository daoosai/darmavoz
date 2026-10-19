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
Итог доставки и проверки реального заказа приведён ниже.

Локальные проверки на ноде: npm run lint — PASS; tests/test_refunds.py — 44 passed (изолированная БД/mock provider); Playwright logist-refund-attention + refunds — 8 passed, 390/1440 px. git diff --check — PASS.

Коммиты: e278b664 — основной (точное сообщение задачи), 91dba7e9 — мобильная видимость вкладки/счётчика, 9cc2e8f5 — актуализация старого unit fixture платежей (cancelled_by_type=None). Все отправлены origin/develop с ноды.
Первый полный CI выявил неполный SimpleNamespace в tests/test_sprint24.py (213 passed, 1 failed); после актуализации fixture совместный локальный прогон tests/test_sprint24.py + tests/test_refunds.py: 81 passed. Линтер повторно PASS, 4 адресных UI-теста повторно PASS с проверкой границ бейджа по ширине экрана.

## Доставка и read-only проверка результата

GitHub Actions Deploy Test Environment [39195149136](https://github.com/daoosai/darmavoz/actions/runs/39195149136) — success, включая полный backend и frontend regression. Build Test Android APK [39195149086](https://github.com/daoosai/darmavoz/actions/runs/39195149086) — success.
Runtime /opt/darmavoz_test_deploy и image backend_test: 9cc2e8f5f2470312ee8265156d2794cd720beded. Внешний /health — online, версия не менялась (3.1.7).

На https://test.darmavoz.ru от реальной роли logist проверены браузером 390/1440 px: на активной вкладке виден красный счётчик 4; после открытия Архива реальный #B6A576 виден с жёлтой плашкой и доступной суммой 10 ₽. Требующие ручного решения строки расположены перед обычными архивными. GET attention_only с городом Тюмень возвращает заказ и корректный остаток. Все не-GET API-запросы браузера блокировались. PUSH на физическом устройстве в этой задаче не проверялся; генерация PUSH/outbox и In-app проверена изолированными backend-тестами.

После проверки повторный SELECT подтвердил: cancelled, Payment succeeded 10.00, auto_refund_requested=false, Refund count=0, requires_manual_refund=true. Реальные отмена/возврат/оплата не выполнялись. Существующие уведомления не пересылались задним числом; старый заказ показывается через новую выборку без изменения БД.

Машиночитаемые подтверждения: [verification.json](reports/2026-10-19-manual-refund-attention/verification.json). Скриншоты archive-390/1440.png и B6A576-390/1440.png сохранены на ноде в docs/reports/2026-10-19-manual-refund-attention/ (не включены в Git). Визуально просмотрена мобильная карточка реального заказа.
Оставшихся действий по коду/доставке нет; решение о сумме возврата остаётся за логистом.
