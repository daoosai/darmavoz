# Административные точки

Вкладка «Точки» использует /api/v1/admin/pickup-points и фильтры города/модерации/размещения/CRM. Для каждой точки pickup_point_payload формирует контакт, предложения, материалы, машины, фото и размещение. Owner.username не гарантированно телефон: он бывает email или архивным идентификатором. display_contact_phone допускает телефоноподобные строки до 20 символов; contact_phone выбирается из owner или точки, owner_phone только из корректного owner. Невалидный контакт становится null, не ломая весь список. Схемы ввода и данные сохраняются.

Файлы: app/services/pickup_points.py, app/api/admin_quarries.py, app/schemas/quarry.py; регрессии tests/test_admin_point_contacts.py. Отчёт: ../2026-10-14-admin-points-server-error.md.
