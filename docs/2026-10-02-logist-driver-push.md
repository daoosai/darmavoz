# 02.10.2026 — убрать Push-индикатор у логиста

Контур: тестовый (develop).
В карточках вкладки «Водители» логиста скрыт индикатор Push для обоих состояний устройства. Общий компонент DriverSummary получил параметр showPushStatus; логист передаёт false, остальные вызовы сохраняют прежнее поведение. Логика доставки уведомлений не изменена.

Проверки перед коммитом: TypeScript (npm run lint), production build и git diff --check прошли на ноде. Node v22.23.3 установлен в /opt/nodejs, команды доступны через /usr/local/bin. Версии приложения и .env не менялись.

Доставка: commit/push develop запускает штатный тестовый pipeline. После завершения проверяются runtime commit, внешний health и отображение карточек на 390/1440 px. Артефакты браузерной проверки на ноде: /tmp/darmavoz-logist-no-push-390.png и /tmp/darmavoz-logist-no-push-1440.png. Итог доставки и фактических проверок сообщается пользователю; этот текст описывает порядок до окончания pipeline.

## Подтверждённый результат

Commit 0cc932626b9afb596bca20f90f7492cdfc961d2a отправлен в develop. GitHub Actions Deploy Test Environment (run 36968230285) и Build Test Android APK (run 36968230292) завершены success. Runtime worktree и label org.opencontainers.image.revision контейнера backend_test совпадают с commit. Внешний health — online.

На внешнем https://test.darmavoz.ru/logist/orders проверено отображение 10 реальных карточек водителей под ролью логиста: Push-индикаторов нет на 390/1440 px. Скриншот мобильной карточки визуально просмотрен. Для чтения UI использован временный 10-минутный JWT существующего логиста, без изменения пользователей или БД. Артефакты: /tmp/darmavoz-live-logist-390.png и /tmp/darmavoz-live-logist-1440.png на ноде.

Документация блока: [Логист — водители](blocks/logist-drivers.md). Добавлены оглавление docs/README.md и обязательное правило документации по блокам в AGENTS.md.
