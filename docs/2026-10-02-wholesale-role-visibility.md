# Видимость биржи сыпучих материалов — 02.10.2026
Контур: develop, /opt/darmavoz_test, test.darmavoz.ru.

По уточнению владельца вкладка «Опт» остаётся только у партнёров driver/supplier.
Для equipment_owner/water_septic_partner восстановлены исходные нижние панели,
из PortalScreen убрано открытие WholesaleScreen.
CommerceMenu профиля также исключает эти роли независимо от выданного допуска.
B2C-клиенту вкладка не добавляется. Staff сохраняет прежние инструменты модерации.
Это изменение интерфейса; API-права и допуски в БД не изменяются.

Обновлены E2E: переход из кабинета driver/supplier на 320/1440px; отсутствие
перехода в нижней панели и профиле equipment_owner/water_septic_partner
даже при enabled=true; отсутствие вкладки у client и пояснение без допуска.
Ключевые файлы: frontend/src/*BottomNav.tsx, *PortalScreen.tsx,
CommerceMenu.tsx; frontend/tests/e2e/sprint24.spec.ts.
Документ блока: blocks/wholesale-navigation.md.

npm run lint: success. Адресные E2E: 10 passed (43.6s).
Commit/push, CI и внешняя проверка будут записаны после доставки.
.env, версии и production не изменяются.
