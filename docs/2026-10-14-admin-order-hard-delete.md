# Полное удаление заказов администратором — 14.10.2026

Контур: /opt/darmavoz_test, develop / test.darmavoz.ru.
Frontend уже использовал DELETE /admin/orders/{id}/hard без PATCH статуса.
Backend удалял лишь EventLog/OrderOffer и ORM-позиции/события, пропуская
PaymentQuote, Payment, дочерние платёжные записи и OrderDistributionHistory.
FK сверены на реальной test PostgreSQL. Push/outbox не имеют FK, очищаются по JSON.

Добавлен отдельный транзакционный сервис; admin endpoint вызывает его.
Общий archive-сервис не заменён. Клиент/материалы/диалоги/другие заказы сохраняются;
при FK-конфликте все изменения откатываются. Описано в blocks/admin-orders.md.
.env, версии, production и настройки provider не менялись. Миграций нет.

Проверки:
- npm run lint — успешно.
- Новые 7 backend тестов во временной БД — passed.
- Браузерный admin-order-hard-delete.spec.ts — 3 passed.
- Старый endpoint отдельно запущен с той же новой фикстурой: HTTP 409 вместо
  ожидаемого 200. Новая реализация проходит, включая полный платёжный граф.
- Уточнена устаревшая проверка soft archive: она сохраняет исходное событие
  и добавляет order_cancelled (ранее тест ошибочно ожидал ровно одно событие).
- Расширенный запуск старого файла: 11 passed, 1 unrelated legacy failure:
  test_logist_cannot_patch_protected_fields_after_driver_assigned ожидает 400,
  текущий unchanged endpoint возвращает 200. Логика редактирования этой задачей
  не менялась; этот тест не включён в заявленные проверки удаления.

Дополнительный вопрос пользователя: клиент может отменить driver_assigned,
но начиная с driver_accepted («Водитель подтвердил заказ») сервер возвращает
409 ORDER_ALREADY_ACCEPTED; UI также не показывает отмену. Далее выезд,
погрузка, доставка/завершение запрещены. Оплата отдельно не является порогом.
Источники: app/api/clients.py cancel_my_order, frontend/src/OrdersScreen.tsx
cancellableClientOrderStatuses. Бизнес-правило не менялось.

Адресная регрессия удаления и архивирования — 9 passed.
Commit/push и фактическая доставка будут дополнены.
