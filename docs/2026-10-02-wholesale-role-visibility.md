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
Commit: f2e120e3 — fix: restrict wholesale requests tab visibility to drivers and suppliers only.
Push origin develop выполнен с ноды. Предыдущий коммит добавления вкладок — 57a367fa.
Deploy Test Environment: success,
https://github.com/daoosai/darmavoz/actions/runs/36999432475
Build Test Android APK: success,
https://github.com/daoosai/darmavoz/actions/runs/36999432661
CI повторно выполнил полный набор Sprint 24 E2E, сборку frontend и backend-проверки.
Runtime /opt/darmavoz_test_deploy: f2e120e3, соответствующий image backend_test.

Внешняя проверка test.darmavoz.ru/app с настоящими текущими аккаунтами и
временными JWT, без изменения данных, 320 и 1440px:
- driver/supplier: видимая вкладка, открытие WholesaleScreen, access API 200,
  возврат обратно. У выбранных аккаунтов enabled=false: показано пояснение допуска;
- equipment_owner/water_septic_partner: вкладки нет, в загруженном профиле
  ссылки «Оптовые заявки» нет;
- client: вход в B2C через «Я Клиент», вкладки нет.
Допущенная лента и отказ допуска отдельно покрыты E2E с mock API.
Скриншоты сохранены на ноде /opt/darmavoz_wholesale_nav_artifacts/2026-10-02/.
Визуально проверены мобильная панель supplier и профиль equipment_owner.
Временные файлы с JWT удалены после проверки. Производственных публикаций нет.

Сверка с текстом спринта, предоставленным владельцем:
все девять полей есть; лента, избранное, телефон/звонок/копирование,
прямое согласование без автоматического назначения реализованы.
Исходный спринт допускает «других согласованных партнёров».
Новое ограничение интерфейса только driver/supplier — последующее продуктовое уточнение.
API сохраняет PARTNER_ROLES из четырёх ролей и ручной допуск администратора:
скрытие навигации не является отзывом API-доступа.
Это соответствует поручению о видимости; если понадобится запрет доступа,
это отдельная правка backend. Ручной допуск всем партнёрам строже одного факта регистрации.
Незавершённых шагов текущей UI-задачи нет.
.env, версии и production не изменяются.
