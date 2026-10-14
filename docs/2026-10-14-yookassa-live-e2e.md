# Проверка тестовой ЮKassa — 14.10.2026

Tech Lead внёс тестовые ключи в .env. Обычный restart backend_test выполнен, но переменные контейнера остались прежними. Затем только backend_test пересоздан через docker compose -f docker-compose.test.yml up -d --no-deps --force-recreate: PAYMENTS_ENABLED=true и PAYMENT_TEST_MODE=true применились. Ключ имеет тестовый префикс; секреты не выводились. .env и production не менялись.

Обнаружено: YOOKASSA_API_BASE_URL отсутствует в .env, default=None делал configured() ложным даже с ключами. В develop установлен стандартный default https://api.yookassa.ru/v3, пользовательский override сохраняется. Реальная оплата запрещена тестовым режимом и проверкой provider test flag. Результат доставки и сквозного теста фиксируется после проверки.
