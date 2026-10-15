# Снятие whitelist-блокировки оптовых заявок
Контур: develop, test.darmavoz.ru.

Любой активный и неудалённый driver/supplier получает доступ к ленте и созданию
без wholesale_access_enabled. Аккаунты inactive/deleted и suspended-водители
отклоняются; client, equipment_owner и water_septic_partner не допускаются.
Staff сохраняет инструменты модерации.
Проверка отдельного допуска и заглушка удалены из WholesaleScreen/CommerceMenu.
Убраны устаревшие API/UI выдачи персонального допуска.
Поле users.wholesale_access_enabled сохраняется для совместимости схемы,
но для доступа к оптовой бирже не используется. Миграции флагов не нужны.
47 backend-тестов Sprint 24 прошли в временной БД; npm run lint прошёл.
Проверки UI и итог доставки дополняются в отчёте полного цикла модерации.
После этой правки владелец расширил задачу полноценной модерацией и PUSH.
Документ блока: blocks/wholesale-navigation.md.

Адресные UI E2E: 11 passed.

Доступ подтверждён внешним UI на активных supplier/driver с флагом допуска false.
Commit f9675b73 доставлен вместе с 6416c4fa, CI success.
Полный live-цикл и итог доставки: 2026-10-02-wholesale-moderation.md.
