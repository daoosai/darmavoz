# Оплата заказов через ЮKassa

Клиент создаёт заказ, логист в OrderPaymentsPanel подтверждает материал/доставку через POST /api/v1/orders/{id}/payment-quote. Клиент получает can_pay=true и создаёт Payment через POST /api/v1/orders/{id}/payments; confirmation_url открывает ЮKassa. При возврате/refresh/worker/webhook состояние сверяется через защищённый API провайдера. Webhook не может сам объявить платёж успешным; проверяются сумма, RUB, shop, metadata, test flag и provider ID. Статус оплаты отдельный от логистического состояния заказа. Повторный запрос сохраняет активный платёж, повторный webhook не дублирует событие успеха.

Конфигурация в app/core/config.py, логика app/services/payments.py, API app/api/payments.py, UI frontend/src/OrderPaymentsPanel.tsx и PaymentReturn.tsx. Default YOOKASSA_API_BASE_URL=https://api.yookassa.ru/v3; override доступен в .env. Ключи вводит владелец. После изменения env_file контейнер нужно пересоздать (один restart не перечитывает переменные Docker).

Режим PAYMENT_TEST_MODE=true, тестовый ключ и проверка provider test=true обязательны для sandbox E2E. Живая проверка 14.10.2026 прошла: корзина → checkout → цена логиста → redirect ЮKassa → тестовый кошелёк → успешный платёж → публичный webhook → «Оплачено» у клиента/логиста. Проверены защита от поддельного success, повторы оплаты и webhook. QA-логист отключён после проверки. Боевые оплаты, фискализация, автоматическая доставка уведомлений из кабинета и возвраты данным тестом не подтверждены. Подробности: ../2026-10-14-yookassa-live-e2e.md; настройки: ../sprint24.md.

## 14.10.2026 — результат оплаты и автоматический возврат

PaymentReturn получает статус через авторизованный GET /orders/{id}/payments.
succeeded: большая зелёная CheckCircle, «Оплата прошла успешно!»,
автоматический переход через 2500 мс к /client/orders/{id} через штатный
openClientOrder App. Параметр payment_order удаляется из записи истории.

pending/waiting_for_capture, а также creating/unknown/waiting_for_payment:
ожидание банка со спиннером, последовательный polling GET с паузой 2500 мс
между запросами. На временную сетевую ошибку проверка повторяется без ложного
сообщения об отказе оплаты. 401/403/404 останавливают polling с пояснением.
Терминальные неуспешные состояния дают спокойный текст и ручной возврат.
Без клиентской авторизации запросов платежей и success-redirect нет.

Экран больше не использует OrderPaymentsPanel: это исключает противоречие
статичного заголовка и отдельного статуса панели, а также дублирование её
опроса/кнопок оплаты на return-экране. Панель остаётся в карточке заказа.
Текущий статус передаётся в клиентский store. Смена order_id, закрытие и
размонтирование очищают таймеры и отменяют незавершённый запрос.
Capacitor appUrlOpen/getLaunchUrl и кнопка возврата в приложение сохранены.

Проверки: frontend/tests/e2e/payment-return.spec.ts и client-order-card.spec.ts,
включены в deploy-test. Отчёт: ../2026-10-14-payment-return-ux.md.
