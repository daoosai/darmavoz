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
