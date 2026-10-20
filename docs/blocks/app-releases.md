# Версии приложения и публикация APK

Контуры версионируются отдельно. Источник версий сборки — frontend/package.json (version, versionCode). package-lock.json хранит совпадающую version; npm run version:sync обновляет Android fallback, Info.plist и Xcode metadata. Повышение версий и серверного .env — только по прямому указанию пользователя.

Main публикует подписанные release APK и AAB через build-apk.yml, затем deploy.yml обновляет веб/backend. Develop публикует test APK/AAB через build-apk-test.yml, веб/backend через deploy-test.yml. APK: /static/darmavoz.apk на production, /static/darmavoz-test.apk на тесте. Сервер GET /api/v1/system/version читает ANDROID_VERSION/WEB_VERSION из .env; новые значения применяются пересозданием контейнера. IOS_VERSION поднимается при iOS-релизе.

Без полного слияния release изменения делают отдельно в исходниках develop и main (изолированный source worktree), коммитят и пушат с ноды. Обязательные проверки: lint/build, CI, фактический manifest опубликованного APK (package/versionName/versionCode), правильный API origin, совпадение серверной версии и health. iOS и магазины не публикуются автоматически задачей выпуска серверного APK.

Отчёт: ../2026-10-12-apk-release.md.

12.10.2026 опубликованы test 3.3.6 (324) и production 3.1.6 (317), подтверждены manifest APK, API версии, web JS, health и backup .env. Отдельные release-коммиты, без полного merge; подробности в отчёте выпуска.

14.10.2026 production API обновлений переведён на Google Play: https://play.google.com/store/apps/details?id=ru.darmavoz.app. Исправлен main fallback APK_DOWNLOAD_URL в app/core/config.py; .env и frontend не менялись, тестовый APK URL сохранён. Runtime b95eae2c, CI и публичные проверки успешны. Подробности: ../2026-10-14-production-update-google-play.md.

## Релиз 3.3.2 (320), 20.10.2026
По прямому поручению владельца — полный merge develop в main с конфликтами в пользу нового develop, без cherry-pick. Исходные версии package/lock, Android, iOS — 3.3.2 и build 320. Серверные .env не меняются. Main ведётся в /opt/darmavoz, runtime /opt/darmavoz_deploy обновляется через deploy.yml. Подробнее: ../2026-10-20-release-3.3.2.md.

20.10.2026 релиз 3.3.2 (320) полностью слит develop→main. Test image/runtime 48379f44, production 2f8ab666; оба backend пересобраны и контейнеры пересозданы. CI Test/Production и APK/AAB success, реальные APK manifest/API origin и public health/version/frontend проверены. .env неизменны по SHA-256, режимы оплаты test/live корректно подхвачены. Production workflow использует только npm ci без установки незакреплённого Capacitor Android. Подробности и ограничение downgrade versionCode 387→320 в отчёте релиза.
