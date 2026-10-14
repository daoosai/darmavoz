# Проверка тестовой ЮKassa — 14.10.2026

Tech Lead внёс тестовые ключи в .env. Обычный restart backend_test выполнен, но переменные контейнера остались прежними. Затем только backend_test пересоздан через docker compose -f docker-compose.test.yml up -d --no-deps --force-recreate: PAYMENTS_ENABLED=true и PAYMENT_TEST_MODE=true применились. Ключ имеет тестовый префикс; секреты не выводились. .env и production не менялись.

Обнаружено: YOOKASSA_API_BASE_URL отсутствует в .env, default=None делал configured() ложным даже с ключами. В develop установлен стандартный default https://api.yookassa.ru/v3, пользовательский override сохраняется. Реальная оплата запрещена тестовым режимом и проверкой provider test flag. Результат доставки и сквозного теста фиксируется после проверки.

## Результат живой проверки

Исправление default API доставлено коммитом d2767f84: Deploy Test 38500349167 и Build Test APK 38500349320 success; запущенный backend PAYMENTS_ENABLED=true, PAYMENT_TEST_MODE=true, configured()=true, /health online. Серверные .env, версии приложения и production не менялись. Изменения кода только backend-настройки; остальные изменения — E2E и документация.

Браузерный сценарий без mock API: вход клиента +79999999999 по штатному OTP, выбор материала, добавление в корзину, расчёт доставки, checkout. Создан заказ bfcc1ca3-7700-40bf-8b75-cb303901fef9. Пароль LOGIST из .env не совпал с БД; существующих пользователей не меняли. Для теста создан отдельный qa-yookassa-e2e-20261014 (UUID 86fd0cf1-2f0b-4fc1-ae1c-ad33a7f44412), вошёл через реальный /auth/login под ролью logist, подтвердил в UI цену 10 ₽ материал + 5 ₽ доставка. После проверки QA-логист отключён; строка сохранена для аудита автора PaymentQuote. Пароль передавался через временный приватный файл root; после проверки файл удалён, в репозиторий не попал.

Клиент увидел «Оплатить заказ», ввёл тестовый email, открыл HTTPS страницу yoomoney.ru. Провайдерный GET проверил test=true и amount=15.00 до оплаты. Тестовый кошелёк ЮKassa завершил платёж: provider_id 3260fbd1-000f-5001-9000-1931784bd934; local payment 2590b385-1cb9-450d-8c20-ff088bdddc11. Провайдер status=succeeded, local status=succeeded, Order.payment_status=succeeded, reconciliation_status=matched, needs_review=false. Логистический status заказа отдельно от статуса оплаты.

До оплаты отправлен payment.succeeded для ещё pending-платежа: ложного зачисления не произошло, backend сверил API ЮKassa. После sandbox оплаты тот же notification POST отправлен дважды на публичный /api/v1/webhooks/yookassa: оба ответа 200, один Payment и ровно одно payment_succeeded событие. Повторный клик оплаты использовал тот же Payment/provider ID. «Оплачено» проверено в UI клиента на desktop 1440x1000 и mobile viewport 390x844, а также в карточке логиста. Оплата настоящим платёжным средством не выполнялась. Подключение доставки уведомлений в кабинете ЮKassa не изменялось: проверена ручная доставка на публичный обработчик. Фискальный receipt_status у тестового платежа отсутствует; выпуск боевых чеков и чек зачёта не входят в эту проверку.

Автопроверки: 63 теста tests/test_sprint24.py и test_sprint24_api.py в отдельной disposable БД без настоящих ключей — pass; npm run lint — pass; node --check live E2E — pass. Живой сценарий: frontend/tests/live/yookassa-payment-flow.cjs; JSON результата: reports/2026-10-14-yookassa-live/progress.json. PNG доказательства остаются на сервере в той же папке. Полный backend/frontend CI первого исправления — success.

## Повторный запуск

Live сценарий запускается только явно, на ноде; Playwright установлен в frontend/node_modules. DARMAVOZ_RUN_LIVE_PAYMENTS=1 node frontend/tests/live/yookassa-payment-flow.cjs, на stdin JSON с username/password действующего QA-логиста и shopId/secretKey тестового магазина. Секреты не печатать и не сохранять в git. Код проверяет тестовый ключ и test=true у провайдера; origin зафиксирован на test.darmavoz.ru. progress.json позволяет продолжить ранее созданный sandbox заказ без повторного списания. Для нового заказа указать отдельную папку отчёта (DARMAVOZ_PAYMENT_E2E_REPORT_DIR); не удалять финансовый аудит предыдущего заказа. Вручную созданный тестовый заказ и платёж сохранены для сверки; возврат и отмена не запускались.

## Финальная доставка

Коммит с точным сообщением пользователя: 64cfd9bd (test: verify YooKassa payment flow and fix bugs if any), push develop выполнен. Финальные Deploy Test 38501302933 и Build Test APK 38501302998 success; runtime 64cfd9bd. После пересоздания CI повторно проверены PAYMENTS_ENABLED=true, PAYMENT_TEST_MODE=true, configured()=true, /health online, Payment.status=succeeded, reconciliation=matched и is_active=false у QA-логиста. Версии остались 3.3.6 (324), production не изменялся. Фискальный чек, боевые платежи, возвраты и настройка webhook в кабинете провайдера остаются за пределами проверки.
