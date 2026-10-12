# Версии приложения и публикация APK

Контуры версионируются отдельно. Источник версий сборки — frontend/package.json (version, versionCode). package-lock.json хранит совпадающую version; npm run version:sync обновляет Android fallback, Info.plist и Xcode metadata. Повышение версий и серверного .env — только по прямому указанию пользователя.

Main публикует подписанные release APK и AAB через build-apk.yml, затем deploy.yml обновляет веб/backend. Develop публикует test APK/AAB через build-apk-test.yml, веб/backend через deploy-test.yml. APK: /static/darmavoz.apk на production, /static/darmavoz-test.apk на тесте. Сервер GET /api/v1/system/version читает ANDROID_VERSION/WEB_VERSION из .env; новые значения применяются пересозданием контейнера. IOS_VERSION поднимается при iOS-релизе.

Без полного слияния release изменения делают отдельно в исходниках develop и main (изолированный source worktree), коммитят и пушат с ноды. Обязательные проверки: lint/build, CI, фактический manifest опубликованного APK (package/versionName/versionCode), правильный API origin, совпадение серверной версии и health. iOS и магазины не публикуются автоматически задачей выпуска серверного APK.

Отчёт: ../2026-10-12-apk-release.md.

12.10.2026 опубликованы test 3.3.6 (324) и production 3.1.6 (317), подтверждены manifest APK, API версии, web JS, health и backup .env. Отдельные release-коммиты, без полного merge; подробности в отчёте выпуска.
