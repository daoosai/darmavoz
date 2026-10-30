# Спринт 26

Подписная модель, прямые расчеты заказов, доступ по категориям, платная вода, общий чат, путь посетителя.

План: [sprint26-plan](../sprint26-plan.md). Состояние: [sprint26-progress](../sprint26-progress.md).

Реализация начата 30.10.2026, только develop/test. Production, .env и version/build не изменять. Полная приемка пока не выполнена.

Единый документ передачи и актуального состояния: [SPRINT_26.md](../SPRINT_26.md). Читать перед продолжением; промежуточные отчёты не заменяют его.


## Sandbox follow-up 30.10.2026

На опубликованном test web проверены покупка, сохранение pending после фактического пересоздания backend и выдача одного grant после подтверждения провайдера. Отдельный test-only тариф 10 ₽ / 3 месяца использован для частичного возврата **3 ₽**, provider succeeded, остаток **7 ₽**. В AdminSubscriptionsScreen отдельное решение keep применено только к исходному grant; это тест технического механизма, не коммерческая политика. [Sandbox report](../reports/sprint26/sandbox-refund.json).

ЮKassa не принимает partial refund <1 ₽ или с остатком 0<остаток<1 ₽. Добавлена проверка `REFUND_PROVIDER_LIMITS` до создания job и подсказка формы. Первоначальная попытка вернуть 0,40 ₽ из 1 ₽ отклонена HTTP400/amount.value, без финансового результата; [безопасная диагностика](../reports/sprint26/sandbox-provider-limit.json). Никакие секреты/реквизиты/confirmation URLs в отчёты не включены.

Проверки после исправления: subscription/billing **34 passed**, lint/TypeScript/frontend build pass. Единый opt-in isolated browser набор **8 passed**. CI релиза28a: **272 backend passed / 172 Playwright passed**; [CI counts](../reports/sprint26/ci-28a-counts.json). Новая проверка лимитов требует следующего develop/test deploy. Физическое устройство/PUSH пока не подтверждены.
