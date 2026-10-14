# Клиентские заказы

OrdersScreen получает заказы текущего клиента через /api/v1/clients/me/orders. OrderCard показывает состав, тип машины, фото, сумму, оплату, водителя и адрес. До подтверждения логистом цены OrderPaymentsPanel объясняет ожидание без повторного уточнения уже рассчитанной суммы; после quote открывает оплату, после succeeded показывает «Оплачено».

Backend list_orders_for_client прикрепляет опубликованные MediaFile материалов и DeliveryOption через attach_catalog_media. UI обрабатывает сетевые ошибки фотографий и переключается материал → машина → локальная иллюстрация. Абсолютные/относительные media URL разрешает resolveMediaUrl. Полоса прокрутки скрыта через hide-scrollbar, прокрутка сохраняется; карточка компактнее на mobile.

Файлы: frontend/src/OrdersScreen.tsx, OrderPaymentsPanel.tsx, App.tsx, store.ts; app/services/catalog_media.py, dispatch_service.py, app/api/catalog.py. Проверки: frontend/tests/e2e/client-order-card.spec.ts, tests/test_client_order_media.py; они включены в test CI. Отчёт: ../2026-10-14-client-order-card.md.
