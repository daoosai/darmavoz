# Почему «Песок лесной» не оформляется — production, 11.10.2026

## Вывод
Ошибка воспроизведена. Причина — данные размещений: публично доступных точек с этим материалом в Тюмени нет. Ошибки join/города или отсутствия цены, объясняющей этот случай, не обнаружено. Код и данные production не изменялись.

Материал a79ed0ba-b185-45b3-97e9-0420ad55efb4 активен, базовая цена 200 ₽/м³. Всего 23 связи с точками: 20 в Тюмени, 3 в других городах. Все 20 тюменских связей активны, цена в связи установлена (13 положительных, 7 нулевых), координаты корректны, moderation_status=approved. Но is_active=false у всех 20; 13 имеют placement_status=hidden, причина confirmation_overdue; 7 — expired. Публично доступных точек любого типа 0, после фильтра quarry также 0.

## Путь запроса и фильтры
Корзина вызывает POST /api/v1/client/orders/calculate, а не GET /cart/points. app/api/client_orders.py → app/services/order_pricing.py: calculate_client_order_options. Checkout повторяет серверный расчёт.

Материал и тип машины должны быть активны, объём/кубатура положительны, координаты доставки корректны. Фильтры точек: точный city_id, is_active=true, moderation_status approved/has_pending_changes, публичный placement_status active/trial/confirmation_required (с поддержкой legacy), неистёкший срок размещения, непросроченное подтверждение с grace period, crm_status=activated, активная связь quarry_materials. Затем проверяются цена (есть fallback на Material.price, бесплатный материал допускает 0) и координаты точки.

Без заданной точки автоматический поиск ограничен point_type=quarry; при явном quarry_id допустимы quarry/accumulator/warehouse/supplier. Это не причина текущего отказа: снятие ограничения типа также даёт 0 публичных точек. Радиус доставки не отсеивает кандидатов на этом этапе. Маршрут 2GIS и тариф расстояния рассчитываются позднее; отказ возникает до запроса маршрута.

READ ONLY скрипт выполнен внутри production backend с SET TRANSACTION READ ONLY. Точный запрос поиска и calculate_client_order_options дают 404 «Подходящие точки не найдены.». Внешний HTTPS POST с этим материалом, Тюменью, машиной 20 м³ и координатами Патрушевой возвращает тот же 404 (error_code 4K2Z8A).

## Что сделать администратору
Переодобрять модерацию не нужно: точки уже approved. Нужно восстановить действующее размещение/актуальность и при необходимости активировать CRM.

Прямые кандидаты с CRM activated и ценой 200 ₽/м³:
- Карьер Масстрой-Светлый (1a9d145a-f59a-4205-9dd4-474dc7d9feb1): hidden/confirmation_overdue, срок до 20.10.2026. Подтвердить актуальность владельцем либо продлить размещение штатной админской операцией, которая обновляет подтверждение.
- Масстрой-Богандинка (976a516f-6011-4972-9c78-aa877b77f0d5): hidden/confirmation_overdue, срок до 01.03.2027. То же действие.
- Масстрой-Якуши (974096fb-d108-4254-9811-125818400864): expired, срок истёк 30.09.2026. Продлить размещение штатной админской операцией.

Подтверждение требуется каждые 14 дней, льготный срок 3 дня. Светлый скрыт 01.10.2026, Богандинка — 04.10.2026. Просто «Восстановить» не сбрасывает просроченное подтверждение: перерасчёт опять скроет точку.

Операции реализованы в app/api/placements.py и app/services/relevance.py: /supplier/points/{id}/confirm-relevance, /admin/pickup-points/{id}/placement/restore и /placement/extend. Для registration_completed дополнительно нужна CRM-активация. Нулевые цены стоит сверить с поставщиком, но фильтр их принимает, и они не вызывают этот отказ.

После восстановления действующего карьера повторить расчёт и проверить маршрут/тариф. Публикация/продление бизнес-данных не были поручены и не выполнялись. Багфикс кода поиска для этого случая не требуется.

## Все тюменские точки
| Точка | Тип | Цена ₽/м³ | Размещение | CRM | Причина скрытия |
|---|---|---:|---|---|---|
| Накопитель на Заре | accumulator | 850.0 | hidden | registration_completed | confirmation_overdue |
| Масстрой-Якуши | quarry | 200.0 | expired | activated | None |
| Карьер Масстрой-Светлый | quarry | 200.0 | hidden | activated | confirmation_overdue |
| Отсыпка сервис, г. Тюмень | quarry | 0.0 | hidden | registration_completed | confirmation_overdue |
| Биг-Строй, строительная компания | quarry | 0.0 | expired | registration_completed | None |
| Литанд, торговая фирма | quarry | 220.0 | hidden | registration_completed | confirmation_overdue |
| Нерудные материалы, торговая компания | quarry | 0.0 | hidden | registration_completed | confirmation_overdue |
| Ялуторовский комбинат строительных материалов, офис продаж | accumulator | 1800.0 | hidden | registration_completed | confirmation_overdue |
| Прометей, компания по продаже щебня, песка | quarry | 220.0 | hidden | registration_completed | confirmation_overdue |
| ТюменьТрансСтрой | quarry | 300.0 | hidden | registration_completed | confirmation_overdue |
| Уральский щебень, компания по продаже песка и щебня, строительству дорог и отсыпке участков | quarry | 350.0 | hidden | registration_completed | confirmation_overdue |
| ППЖТ-строй | quarry | 1200.0 | hidden | registration_completed | confirmation_overdue |
| Сибтранс | accumulator | 700.0 | hidden | registration_completed | confirmation_overdue |
| Викинг, строительная компания | accumulator | 0.0 | expired | registration_completed | None |
| Карьер Нижнетавдинский 2 | quarry | 180.0 | hidden | registration_completed | confirmation_overdue |
| Масстрой-Богандинка | quarry | 200.0 | hidden | activated | confirmation_overdue |
| АрМан, компания по благоустройству территории | accumulator | 0.0 | expired | registration_completed | None |
| Альфа-групп | accumulator | 0.0 | expired | registration_completed | None |
| Песок-72 | accumulator | 600.0 | expired | registration_completed | None |
| Альфа-строй, офис | accumulator | 0.0 | expired | registration_completed | None |

Артефакты: reports/2026-10-11-forest-sand-cart-audit/read_only_audit.py и production-points.json.
