# Спринт 26 — утвержденный объем

Основание: пользователь утвердил план 26.1–26.7 и разрешил полную реализацию, тестовые миграции, develop push, test web/backend и прямой test APK. Подтверждения отдельных этапов не требуются. Production/main/workflows production запрещены. Серверные .env и version/build не изменять. Чужие изменения сохранять. Исходная версия 3.3.3/391; выпуск идентифицировать SHA и артефактом.

## Решения

1. Подписка на аккаунт и категорию, восемь категорий: quarry, accumulator, driver, carrier, equipment, water, firewood, septic. Роли не создавать заново; carrier использует driver, firewood — supplier/catalog.
2. Новые заказы — только прямые расчеты вне приложения. Сохранить цены, оформление, исполнение и старые финансовые операции. Старые APK не должны создавать новые платежи за заказ.
3. Trial 14 дней от явной активации, однократно по категории и подтвержденному контакту. Транспорт: постоянный реестр нормализованных номеров, общий driver/carrier, проверка каждой машины. Платная категория покрывает парк. Смена номера/телефона не стирает историю. Спорные случаи решает admin с журналом.
4. Существующие сроки сохранить без нового trial. Точки без хозяина сохраняют подтвержденный остаток по объекту, далее серые без контактов/заказов; администратор привязывает владельца. Неподтвержденные данные не выдумывать.
5. Завершение принятого/назначенного рейса разрешено после истечения доступа; новые офферы/accept/manual assign запрещены. Сохранить 120 секунд, отказ, штрафы, добавить повтор поиска от 60 секунд.
6. Публичные карточки после истечения остаются, контакты и новые заявки закрыты. Зеленый/серый дизайн сохранить, внутренние CRM/модерационные запреты не раскрывать. Сохранить авто quarry/manual другие точки.
7. Вода: backup + предварительный список + удаление бесплатных с зависимостями только test. Запрет free на всех API/формах/БД. Повторный импорт только продавцов, неизвестная цена — staging/moderation, не фиктивная публикация.
8. ЮKassa только subscription, отдельные тестовые тарифы test-shop. Все неутвержденные коммерческие тарифы draft; carrier без цены. Никаких автоcписаний/магазинного биллинга. Платеж идемпотентен, успех проверяется сервером, webhook/worker восстанавливаются после restart.
9. Возвраты подписок связаны с payment и grant, защищены от повторов. Изменение доступа — отдельное явное решение только по grant этого платежа; без решения review, другие основания не затрагивать. Коммерческие правила возврата не утверждены.
10. Чат один, text/poll 5s/cursor; trial/paid/legacy категории дают доступ, B2C тарифа нет. Admin служебно без подписки; модератору нужен доступ. Mute/ban/remove/restore, warnings, moderators, rules/pins, audit. Оплата не снимает санкции, expiry закрывает чтение и отправку.
11. Аналитика: anonymous visitor/session/attempt; server truth для login/order/payment; связь истории только после подтвержденного входа, без угадывания устройств. Offline queue/dedupe, контакты masked/RBAC, никаких OTP/password/token/card. Вход 10min, order/payment 30min, события 90d/контакты30d, все настраиваемо. Owner in-app/PUSH, recipient конфигурируется, inactivity notifications отдельно.
12. UI админа: visitors, chronology, filters, attempts/orders/payments/notification delivery, aggregates. Add client received/review(1–5/optional text), отдельные события без изменения delivery enums/ranking.
13. Сохранить дизайн: reuse existing screens/components. Все новые экраны законченные, состояния loading/empty/error/offline. Проверить 360/390/768/1024/1440, orientations, safe areas/nav/keyboard/long content. Screenshots и исправления обязательны.
14. Все этапы последовательно до test release. Backend + isolated migration tests + tsc + build + Playwright + live test + visual/APK. Physical APK/PUSH только если устройство доступно; отсутствие явно отметить и дать инструкцию, no_device не доказательство.

## Этапы и приемка

26.1 Документация, baseline, новые additive migrations/flags, transition report.
26.2 Category/plan/access/identity/vehicle-trial ledgers, admin/config/API, boundary/concurrency tests.
26.3 Subscription checkout/refund jobs/receipts/history/webhooks; direct-order compatibility and UI; test-shop E2E без real money.
26.4 Central capability checks for map/contact/cart/orders/equipment/water/septic/dispatch/manual; accepted job completion; retry workers.
26.5 Paid water schema/UI/backup/list/cleanup/reparse/staging/dedup.
26.6 General chat UI/API/moderation/access/history/audit/pins.
26.7 Journey event collection/server instrumentation/admin dashboards/settings/owner alerts/retention/client received & review.
Release: combined tests/migrations/CI/visual/built APK, docs handover, only develop and test deploy. Не завершать при заглушках/существенных непроверенных сценариях.

## Коммерческие вопросы до production (разработку не блокируют)

Draft цены: driver/water/firewood/septic 1900/5400/10200/19200; quarry/accumulator 2900/8400/16200/30000; equipment предложен 1900/5400/10200/19200; carrier цена не определена. Утвердить тарифы, receipts/VAT/offer/privacy, refund/access policy, disputed legacy owners, import territory, recipient/devices, anti-fraud retention, release version. Не активировать неизвестную цену.
