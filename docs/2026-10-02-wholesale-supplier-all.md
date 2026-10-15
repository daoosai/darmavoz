# Все собственные заявки поставщика в общей вкладке — 02.10.2026

Контур: develop / /opt/darmavoz_test / test.darmavoz.ru/app.

Причина: GET /wholesale-requests?view=all для любой роли ограничивался
approved и актуальными сроками. Поэтому собственные draft/pending/rejected
поставщика были доступны только в mine.

Теперь для supplier view=all использует один SQL OR:
author_id == текущий пользователь ИЛИ (approved И ends_on >= today).
Вкладка объединяет опубликованную биржу и все собственные заявки: draft,
pending, rejected, approved, archived, включая собственные истёкшие.
Один запрос исключает дубли; поиск, город, сроки, total и pagination применяются
к объединению. is_owner/бейджи/причины/редактирование используют прежнюю карточку.
Driver и прочие роли сохраняют общую опубликованную ленту; favorites и mine,
модерация и права чтения конкретной карточки не меняются.

Проверки: npm run lint; pytest tests/test_sprint24.py tests/test_sprint24_api.py
в одноразовой БД. Новый API-тест покрывает все собственные статусы, истёкшие,
чужие статусы, driver, favorites, фильтр сроков и пагинацию без дублей.
Delivery и внешняя UI/API-проверка записываются после push в
docs/reports/wholesale-supplier-all-live.json на ноде.
Миграции, .env, версии и production не меняются.
