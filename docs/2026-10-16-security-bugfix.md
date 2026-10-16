# Security & Bugfix — выполнение утверждённого плана
Контур develop, /opt/darmavoz_test, test.darmavoz.ru. Production не меняется.
Версии приложения/сборки и серверные .env не меняются.
Базовая ревизия e58697c1. План: 2026-10-16-audit-remediation-plan.md.

## Critical
- SEC-01: Capacitor core/android/ios/cli фиксируются на 8.4.3; проверка native patches, lint/build/sync и Android CI.
- SEC-02: пять host ports тестового контура привязаны только к 127.0.0.1.
  Docker-сеть и внутренние адреса Caddy/DB/Redis/MinIO сохранены.
Проверки и фактическая доставка дополняются по результату, не считаются завершёнными заранее.

## Medium / Minor
В работе. Результаты тестов, коммиты и доставка будут записаны после проверок.

### Промежуточные проверки
- Порты 5433/6380/8001/9002/9003 после пересоздания test-сервисов недоступны
  с внешнего хоста; Caddy -> backend_test:8000 /health отвечает online.
- lint/build/sync Android после Capacitor 8.4.3 прошли; iOS patch version guard
  обновлён; test APK workflow больше не переустанавливает unpinned Android.
- 94 backend tests security/auth/driver OTP/wholesale/refunds passed в отдельных
  Postgres/Redis. Legacy JOSE JWT и auth_version проверены.
- pip check: pass. pip-audit resolved Python 3.11 constraints: 0 advisories.
- .dockerignore дополнен исключением серверных .env из image build context.
Финальная регрессия и доставка ещё не завершены.

## Minor — реализация
- OperatorCityBar/Field: ограничены flex intrinsic widths (w-full/min-w-0,
  select w-0/flex-1), без overflow-hidden на документе.
- Общая ReasonModal принимает presets; обе точки оптовой модерации используют
  четыре утверждённых шаблона с редактируемым текстом и сбросом между заявками.
- Уточнение UI-03 исходного аудита: в текущем исходнике уже существовало
  общее aria-label="Добавить объявление". Оно конкретизировано до
  "Добавить объявление спецтехники"; добавлены title и aria-hidden на SVG.
  Это усиление/регрессия доступности, а не подтверждённое отсутствие aria-label.
- 15 новых браузерных security/UI тестов прошли (layout 12 + presets 1 +
  keyboard accessibility 2). Дальнейшая общая UI-регрессия выполняется.
- flake8 обнаружил в equipment.py старый недостижимый дубликат после return
  с неопределёнными именами; удалён только этот недостижимый блок.
- Старые тесты уточняются под supplier-only публикацию и реальную пакетную
  обработку outbox (30 записей), не ослабляя проверку доставки нужной причины.
