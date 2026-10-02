# Навигация оптовых заявок
Контур: develop / test.darmavoz.ru.

В основных панелях driver, supplier, equipment_owner, water_septic_partner
есть вкладка «Опт» с Briefcase из lucide-react. Она видна независимо от допуска.
При нажатии выбирается локальная вкладка wholesale и открывается существующий
WholesaleScreen (CommerceShell). Отдельного URL для этого экрана нет:
используется тот же экран, что и в CommerceMenu профиля.
«Назад» возвращает на основной экран соответствующего кабинета.

Кабинеты используют нижнюю навигацию и на мобильном, и на desktop;
отдельного Sidebar в этих четырёх кабинетах нет.
Отступы партнёрских панелей уменьшены для размещения дополнительной вкладки.
Навигация B2C-клиента не изменена, вкладка «Опт» в неё не добавляется.

API-допуск сохранён: /wholesale-requests/access проверяет доступ,
без допуска экран показывает инструкцию обращения в поддержку.
Навигация не выдаёт права и не меняет wholesale_access_enabled.

Ключевые файлы:
- DriverOrdersScreen.tsx;
- SupplierBottomNav.tsx / SupplierPortalScreen.tsx;
- EquipmentOwnerBottomNav.tsx / EquipmentOwnerPortalScreen.tsx;
- WaterSepticPartnerBottomNav.tsx / WaterSepticPartnerPortalScreen.tsx;
- WholesaleScreen.tsx, CommerceShell.tsx.

Все файлы frontend находятся в frontend/src/.
Регрессии: frontend/tests/e2e/sprint24.spec.ts — четыре партнёрские роли,
320/1440px, нажатие вкладки из кабинета, загрузка ленты, возврат,
пояснение без допуска и отсутствие вкладки у client.
Проверки и доставка: ../2026-10-02-wholesale-navigation.md.
