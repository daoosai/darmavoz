# HTTP 500 в административных точках — 14.10.2026

Только develop/test. Ошибка подтверждена в живом API: GET /api/v1/admin/pickup-points и placement_status=hidden возвращали 500. ResponseValidationError: contact_phone превышает 20 символов, потому что pickup_point_payload подставлял owner.username с архивным суффиксом _del_. Также email-логин мог попасть в поле телефона.

В payload теперь выбирается только телефоноподобное значение длиной до 20: действующий формат owner.username, иначе собственный contact_phone точки, иначе null. В owner_phone email/архивный идентификатор также не попадает. Записи БД не меняются, input-схемы не ослабляются, список не падает из-за одного контакта. Исправление backend, frontend/версии/.env/production не меняются.

В тех же логах найдена регрессия клиента после a2ebfeb4: дополнительный запрос MediaFile выполнял autoflush после hydrate_order_route_fields и истекали вычисляемые payment_status/confirmed_payment_amount/refund_status/city_name. Сериализация старого заказа с address, но без delivery_address, падала MissingGreenlet. В list_orders_for_client загрузка media выполняется внутри session.no_autoflush: fallback полей адреса остаётся только в ответе, без записи в БД. Тест media дополнен старым адресом; до исправления воспроизвёл те же четыре ошибки, после — pass.

Регрессии: tests/test_admin_point_contacts.py проверяет список и detail для архивного владельца, email-логина и обычного телефона (приоритет сохранён); test_client_order_media.py проверяет старый адрес и медиа. Эти проверки плюс nullable schemas прошли (8). Flake8 critical — pass. Пять старых тестов test_pickup_points_sprint14.py падают одинаково с исправлением и на исходном 77b0a129 из-за старых fixture статусов/правил публичности; это не регрессия исправления, их правила не менялись. Новые контакты включены в CI deploy-test.

Финальная доставка и живые API/браузерные проверки фиксируются после deploy.
