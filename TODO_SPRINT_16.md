# TODO Sprint 16

## 1. ⚙️ BACKEND (SMS Tech Debt & Configs)

- [x] Удалить легаси-переменные `SMSC_LOGIN` и `SMSC_PASSWORD` из `app/core/config.py`.
- [x] Переписать `test_sms.py` под логику `SMS.ru`.
- [x] Очистить логи и имена переменных от упоминаний `smsc` и заменить их на `sms_auth`.
- [x] Обновить `PROJECT_STATE.md`: указать, что рабочий стек проекта — `FastAPI + React/Capacitor`, а папка `mobile` является deprecated Flutter legacy.

## 2. FRONTEND & MOBILE (PWA + Capacitor iOS)

- [x] Починить кодировку UTF-8 в `frontend/index.html`, `frontend/capacitor.config.ts`, `frontend/vite.config.ts`.
- [x] Добавить Apple meta-теги в `frontend/index.html`: `apple-mobile-web-app-title`, `viewport-fit=cover`, `lang="ru"`.
- [ ] Обновить PWA manifest через `vite-plugin-pwa`: добавить описание, ориентацию и корректные иконки.
- [ ] Добавить пакет `@capacitor/assets` в `frontend/package.json` и создать npm-скрипт `assets:generate`.
- [ ] Установить `@capacitor/ios` и выполнить `npx cap add ios` в `frontend`.
- [ ] Обновить `frontend/capacitor.config.ts`: задать `appId` `ru.darmavoz.app` и корректный `appName`.

## 3. CI/CD & VERSIONING

- [ ] Создать скрипт единого версионирования, например `scripts/sync_version.js`, который берёт версию из `frontend/package.json` и синхронизирует её с Android, iOS и backend-конфигурацией.
- [ ] Отрефакторить Android workflow: убрать хардкод версий и вынести общие шаги подготовки в начало pipeline.
- [ ] Создать новый workflow `.github/workflows/build-ipa-test.yml` для iOS: `macos-latest`, `npm run build`, `npx cap sync ios`, сборка через `xcodebuild` без подписи.

## 4. QA & УТВЕРЖДЕНИЕ

- [ ] Сборка Web, Android и iOS проходит без ошибок.
- [ ] PWA корректно устанавливается на iPhone: отображается иконка, статус-бар корректный, лишних рамок нет.
