# Адреса клиента

`ClientAddressBottomSheet.tsx` выбирает адрес через подсказки 2GIS или reverse geocoding карты. Авторизованный клиент сохраняет его через POST /api/v1/client/addresses; редактирование использует PUT /api/v1/client/addresses/{id}. Контракт: full_address, lat, lon, comment, city_id (город добавляет cityFetch). Отдельные street/house не требуются. Backend: app/api/client_addresses.py, app/schemas/client.py.

Неуспешный ответ теперь разбирается через handleApiError: пользователь видит причину API, а не один общий текст. При 401 показывается повторный вход через штатный ClientAuthBottomSheet; адрес, координаты и комментарий остаются в форме для повторного сохранения после входа. Проверка JWT и прав backend сохраняется. Глобальный Toaster задаёт красный стиль error и зелёный success раздельно.

Регрессии: frontend/tests/e2e/client-address-saving.spec.ts — подсказка, карта, 409, 401 с повторным входом/сохранением, 422. Дополнительные backend CRUD-тесты: tests/test_client_addresses.py. Расследование 11.10.2026: [отчёт](../2026-10-11-client-address-saving.md).
