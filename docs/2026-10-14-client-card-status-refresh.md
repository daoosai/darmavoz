# Клиентская карточка: текст доставки и обновление оплаты — 14.10.2026

Контур: /opt/darmavoz_test, develop / test.darmavoz.ru.

Изменено:
- heading_to_client в клиентском маппере → «Едет к вам».
- Клиентская кнопка обновления оплаты отображается только в ожидании;
  succeeded/paid скрывают её полностью, включая историю с прошлым успехом.
- Сотруднический статус и обновление платежей сохранены.
- Backend, .env и версии приложения не менялись.

Блок: blocks/client-orders.md.
Проверки на ноде:
- npm run lint — успешно.
- npm run build — успешно.
- Существующий client-order-card.spec.ts — 25 passed.
- Браузер на собранном frontend (Vite preview): 20 проверок на 390/1440px:
  succeeded/paid скрывают refresh; pending/waiting_for_capture/
  waiting_for_payment/creating/unknown/quote показывают;
  unconfirmed/canceled скрывают. Бейдж heading_to_client — «Едет к вам».
  API перехватывается; реальные заказы и платежи не меняются.

Фактическая доставка будет дополнена после push.
