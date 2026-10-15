# Экстренный релиз 3.1.7 (387), 15.10.2026

Явное поручение владельца: установить 3.1.7 / Android 387, затем полностью
слить develop в main и доставить все изменения, включая возвраты ЮKassa.
Серверные .env уже обновлены владельцем; агент их не редактирует.

Обновляются package.json, корневые версии package-lock, Android fallback,
iOS Info.plist и обе конфигурации Xcode. Источник синхронизации — package.json.

Production merge выполняется в /opt/darmavoz (main); /opt/darmavoz_deploy —
runtime worktree, который обновляет workflow. Обе рабочие копии были чистыми.
Чужие audit-документы и изменения docs/README в test сохраняются вне коммита.

Устранён случай пустого production Git bundle при совпадении HEAD исходников
с SHA релиза: передаётся последний коммит с имеющимся на сервере родителем.
Runtime обновляется только при чистом дереве, без reset --hard.
Backend получает label commit, миграция выполняется одним процессом до
пересоздания backend. Файлы .env не меняются.

Результаты lint, commit/push develop/main, merge, доставки и проверки версий
будут дополнены по фактическому завершению релиза.

Перед коммитом npm run version:sync и npm run lint прошли. В production .env ANDROID_VERSION/IOS_VERSION/WEB_VERSION=3.1.7. В test ANDROID_VERSION/WEB_VERSION=3.3.7, IOS_VERSION=3.1.7 — требуется ручная корректировка владельцем, env не изменялся.
