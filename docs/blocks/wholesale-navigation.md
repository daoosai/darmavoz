# Навигация оптовых заявок
Контур: develop / test.darmavoz.ru.

В основных панелях driver, supplier
есть вкладка «Опт» с Briefcase из lucide-react. Она видна независимо от допуска.
При нажатии выбирается локальная вкладка wholesale и открывается существующий
WholesaleScreen (CommerceShell). Отдельного URL для этого экрана нет:
используется тот же экран, что и в CommerceMenu профиля.
«Назад» возвращает на основной экран соответствующего кабинета.

Кабинеты используют нижнюю навигацию и на мобильном, и на desktop;
отдельного Sidebar в этих кабинетах нет.
Отступы партнёрских панелей уменьшены для размещения дополнительной вкладки.
Навигация B2C-клиента не изменена, вкладка «Опт» в неё не добавляется.

Доступ предоставляется активным driver/supplier по роли. Персональный
wholesale_access_enabled больше не проверяется. Заглушка допуска удалена,
проверки неактивных/удалённых и suspended-водителей сохраняются.
Поле в БД остаётся как legacy, выдача допуска в UI/API удалена.

Ключевые файлы:
- DriverOrdersScreen.tsx;
- SupplierBottomNav.tsx / SupplierPortalScreen.tsx;
- CommerceMenu.tsx — ссылки профиля ограничены driver/supplier и staff;
- WholesaleScreen.tsx, CommerceShell.tsx.

Все файлы frontend находятся в frontend/src/.
Регрессии: frontend/tests/e2e/sprint24.spec.ts — driver/supplier на 320/1440px,
нажатие вкладки из кабинета, загрузка ленты и возврат; создание без whitelist;
отсутствие вкладки у client и у equipment_owner/water_septic_partner,
в том числе в профилях даже при enabled=true в ответе проверки допуска.
Проверки и доставка: ../2026-10-02-wholesale-navigation.md.

Уточнение продуктового аудита: биржа сыпучих материалов доступна в навигации
только driver и supplier. Для equipment_owner и water_septic_partner переходы
убраны из нижней панели и CommerceMenu профиля. Staff сохраняет доступ к модерации. Актуальное правило: только активные
driver/supplier без whitelist; остальные партнёрские роли отклоняются backend.

Итог ограничения ролей: 10 адресных E2E и lint прошли; CI success,
runtime/image f2e120e3. Внешние кабинеты всех пяти ролей проверены на 320/1440px.
Полный отчёт: ../2026-10-02-wholesale-role-visibility.md.

Актуальный цикл: создание pending; администратор approve/reject с обязательной
причиной; исправление rejected снова pending с очисткой reject_reason; approved
появляется в ленте. Решения ставят PUSH и запись центра уведомлений в транзакции.
Админ открывает очередь из «Модерация» → «Оптовые заявки».
Полный текущий отчёт: ../2026-10-02-wholesale-moderation.md.

На 02.10.2026 полный цикл проверен через внешнюю навигацию supplier/admin/driver
на test.darmavoz.ru/app; runtime/image 6416c4fa, CI success, миграция head.
Создание, отклонение, уведомления в колокольчике, исправление, одобрение,
лента и контакты водителя прошли. Физическая FCM-доставка требует устройства.

UX/layout 02.10.2026: партнёрский CommerceShell встроен в кабинет,
BottomNav доступен в списке, деталях и форме. Переход из профиля использует
ту же вкладку кабинета. Колокольчик справа в header, контент имеет отступ меню.
Каталог вызывается с завершающим / без HTTPS->HTTP редиректа, есть ручное название.
Адреса используют общую цепочку 2GIS, телефон — formatPhoneNumber с нормализацией API.
Отчёт: ../2026-10-02-wholesale-form-layout.md.

Итог UX/layout: lint/build и 26 E2E прошли, commit 0b8a7e5f доставлен CI success.
Реальный supplier/driver UI на 320/1440 прошёл: каталог, маска, реальные ответы 2GIS
для обоих адресов, доступное меню и колокольчик в header, переход из профиля.
Новых заявок при этой проверке не сохраняли.

Необязательное количество машин/общая карточка: vehicle_count nullable,
пустое поле формы отправляет null, null/0 не выводят строку машин.
WholesaleRequestCard используется в preview, модерации и партнёрской ленте/деталях:
структурированный маршрут, читаемые даты, ставка, контакты с маской.
Одинаковые даты показываются один раз. Поле заданного числа сохраняет ограничения.
Миграция s24_wholesale_optional_vehicles; отчёт ../2026-10-02-wholesale-optional-count-card.md.

Админская навигация/уведомления: прямой пункт sidebar «Оптовые заявки» ->
/admin/wholesale, очередь moderation. POST/PUT/rejected-submit уведомляют активных
admin через inbox/outbox в транзакции, pending-submit идемпотентен.
Deep link админа открывает конкретную карточку на новом маршруте.
Карточка скрывает контактные действия для is_owner, разносит footer-кнопки
и сокращает маршрут через formatShortAddress.
Отчёт: ../2026-10-02-wholesale-admin-navigation-notifications.md.

## Отдельный экран админа и черновики

/admin/wholesale использует AdminWholesaleScreen внутри AdminDashboard, без
полноэкранного CommerceShell. Header/колокольчик/выдвижной sidebar доступны.
Статусные фильтры используют GET /wholesale-requests?view=moderation&status=...
(admin only); pending-карточки сразу показывают approve/reject с ReasonModal.
Профиль и общий раздел модерации ведут на тот же маршрут, deep link открывает
карточку и историю. Партнёрский banner/create/mine/favorites здесь отсутствуют.

POST/PUT /wholesale-requests?draft=true сохраняют приватный draft/«Черновик»
без уведомления admin. Черновик доступен автору в «Мои заявки» и форме
редактирования; кнопка «Отправить на модерацию» отправляет pending и уведомление.
«Сохранить черновик» и «Предпросмотр» доступны отдельно.
Миграция s24_wholesale_drafts; отчёт ../2026-10-02-wholesale-admin-view-drafts.md.

## Интерфейс исполнителя

В WholesaleScreen driver видит только Все/Избранное и фильтры, без баннера,
создания, Моих заявок и редактирования. supplier сохраняет полный цикл.
Старые уведомления driver выбирают all вместо скрытой mine.
Отчёт: ../2026-10-02-wholesale-driver-view.md.
