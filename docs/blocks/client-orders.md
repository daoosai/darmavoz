# Клиентские заказы

OrdersScreen получает заказы текущего клиента через /api/v1/clients/me/orders. OrderCard показывает состав, тип машины, фото, сумму, водителя, адрес и оплату. До подтверждения логистом цены OrderPaymentsPanel объясняет ожидание без повторного уточнения уже рассчитанной суммы; после quote открывает оплату, после succeeded показывает «Оплачено».

Backend list_orders_for_client прикрепляет опубликованные MediaFile материалов и DeliveryOption через attach_catalog_media. UI обрабатывает сетевые ошибки фотографий и переключается материал → машина → локальная иллюстрация. Абсолютные/относительные media URL разрешает resolveMediaUrl. Полоса прокрутки скрыта через hide-scrollbar, прокрутка сохраняется; карточка компактнее на mobile.

Файлы: frontend/src/OrdersScreen.tsx, OrderPaymentsPanel.tsx, App.tsx, store.ts; app/services/catalog_media.py, dispatch_service.py, app/api/catalog.py. Проверки: frontend/tests/e2e/client-order-card.spec.ts, tests/test_client_order_media.py; они включены в test CI. Отчёт: ../2026-10-14-client-order-card.md.

14.10.2026: media-запрос в списке заказов выполняется с no_autoflush. Заполнение старых адресных полей для ответа не должно выполнять UPDATE и истекать вычисляемые поля оплаты/города. Регрессия воспроизводится в test_client_order_media.py с address без delivery_address.

## 14.10.2026 — порядок карточки и приоритет оплаты

OrderCard: материал и объём → тип машины и рейсы → изображение →
сумма → водитель (имя, марка; госномер скрыт по пожеланию пользователя) → адрес и город →
OrderPaymentsPanel → отмена. Метаинформация и запрос уточнения сохраняются
перед основными блоками. Блок водителя условный: появляется при назначении.

Для клиента getClientOrderDisplayStatus/getClientOrderTrackerProgress
показывают «Ожидает оплаты», когда API разрешает оплату (can_pay=true)
и статус pending/waiting_for_payment; подтверждённый quote без попытки
также означает ожидание оплаты. Состояние платежей хранится по order_id
в неперсистентном useClientOrdersStore. OrderPaymentsPanel обновляет его
при загрузке/обновлении оплаты. FloatingOrderTracker получает доступность
платежа для отслеживаемого заказа при штатном опросе, поэтому приоритет
работает до посещения вкладки заказов.

После succeeded, при закрытой оплате и завершённых/отменённых заказах
действует обычный статус доставки. Процент прогресса, статус заказа в БД,
сотруднические статусы и правила отмены не меняются. Данные оплаты
сбрасываются вместе с заказами при выходе.

Файлы: OrdersScreen.tsx, FloatingOrderTracker.tsx, OrderPaymentsPanel.tsx,
store.ts, utils/statusMapper.ts. Регрессии расширены в
frontend/tests/e2e/client-order-card.spec.ts: mobile/desktop порядок,
доступная/закрытая оплата, трекер без открытия заказа и переход succeeded.
Отчёт: [порядок и оплата](../2026-10-14-client-order-layout-payment.md).

14.10.2026: госномер больше не отображается клиенту. Данные машины в API
и интерфейсах сотрудников не менялись; E2E проверяет отсутствие номера.
