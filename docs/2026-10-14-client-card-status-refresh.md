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

Итоговая доставка:
- Commit 4a3bbc2f с указанным пользователем сообщением; push develop успешен.
- Deploy Test Environment 38527254036 — success.
- Build Test Android APK 38527254011 — success.
- Runtime /opt/darmavoz_test_deploy — 4a3bbc2f.
- GET https://test.darmavoz.ru/health — online, версия 3.3.6.
- На опубликованном frontend повторены 20 браузерных проверок, все успешны.
  API перехватывался; новые платежи и заказы не создавались.
- Реальный оплаченный заказ f0004656-434a-4d49-a723-49dcf14e161b проверен
  только чтением на 390/1440px: «Оплачено», кнопка обновления отсутствует.
- Скриншот оплаченного heading_to_client на 390px визуально просмотрен:
  бейдж «Едет к вам», refresh отсутствует, трекер сохраняет 80%.
- Артефакты: docs/reports/2026-10-14-client-card-status-refresh/
  browser-check.json, live-paid-readonly.json и скриншоты paid/real-paid.
- .env, версии и production не менялись. Физическое устройство не проверялось.
