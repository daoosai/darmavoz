# Корзина: выбор точки после ошибки — 16.10.2026

Контур develop, /opt/darmavoz_test, test.darmavoz.ru.
При отсутствии подходящего карьера кнопка открывала MaterialBottomSheet выбора
машины/объёма. Теперь открывает существующую карту точек PickupPointMapScreen
для материала позиции, включая накопители.

Ручная точка сохраняется в persisted корзину (preferredPointId). Calculate и checkout
передают её quarry_id; reload и переход между вкладками не возвращают автоподбор.
При смене машины ручной выбор сбрасывается, как и ранее.
Backend, критерии автоподбора, .env, версии и production не менялись.
Данные прошлого поручения (цена 1, нулевой городской тариф больших самосвалов)
сохраняются. Новых изменений БД, заказов или платежей в этой задаче нет.

Ключевые файлы: frontend/src/CartScreen.tsx, frontend/src/store.ts.
Регрессия: frontend/tests/e2e/cart-pickup-fallback.spec.ts; test workflow включает её.
Подробнее: blocks/cart-pickup-point-validation.md.

Проверки на ноде: npm run lint — pass; Playwright cart-pickup-fallback —
2 passed (390 и 1440 px), SDK/API в регрессии подменены фикстурами.
CI/deploy и внешняя проверка фиксируются после доставки. Зафиксированный сценарий: 10 м³ Боя кирпича, Новый накопитель,
Пермякова 9, материал 10 ₽ + доставка 0 ₽ = 10 ₽.
