# Клиентская карточка заказа: оплата, фото, прокрутка — 14.10.2026

Только develop/test. До подтверждения цены клиент видит заголовок «Ожидает подтверждения» и пояснение «Оплата станет доступна после проверки заказа логистом». Подтверждённая цена, доступная оплата и успешный платёж сохраняют прежние состояния; сотрудникам сохранён интерфейс подтверждения цены.

Причина фото: catalog API прикреплял MediaFile/primary_image_url к материалам и машинам, client orders API — нет. Общая загрузка вынесена в app/services/catalog_media.py и применяется к материалам/DeliveryOption списка заказов одним запросом; схема/БД не менялись. UI пробует фото материала (primary/media/legacy), затем выбранной машины, затем bundled SVG грузовика. Ошибка загрузки переключает источник, не оставляя broken img. Относительные URL разрешаются через существующий resolveMediaUrl с VITE_S3_URL/API base; bundled static использует API origin и работает в APK.

OrdersScreen уменьшает отступы, заголовок и высоту фото (128px mobile/160px desktop). Использован существующий hide-scrollbar для main и модального списка; пока клиентская страница заказов открыта, scrollbar скрыт также у html/body. Классы html/body снимаются при уходе со страницы. Скролл жестом/колесом не блокируется. ClientOrderSummary дополнен полями изображений DeliveryOption.

Проверки: npm run lint/build — pass; 6 Playwright сценариев на mobile/desktop, фото 404/fallback, confirmed/paid UI — pass; регрессия API primary material/delivery media — pass; 67 существующих backend тестов Спринта 24/dispatch — pass. Новые backend/E2E проверки добавлены в deploy-test.yml. Реальный deploy и браузерные проверки фиксируются после доставки. Версии и .env не менялись; production не затрагивается.
