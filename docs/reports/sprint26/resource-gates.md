# Проверки ограничений ресурсов — 2026-10-30

Контур: disposable QA DB, не runtime. Source dirty поверх 907182ae. Никаких реальных списаний или сообщений.

Команда: `python3 /tmp/s26-qa-run.py "pytest -q tests/test_sprint26_resource_gates.py --disable-warnings --maxfail=3 --tb=short --show-capture=no"`.

Результат: **4 passed, 4 warnings, 7.83s**.

Проверено:
- Истёкший approved накопитель с активной CRM остаётся в public global map/detail, недоступен для расчёта заказа, не раскрывает phone/parsed contacts/description; grant восстанавливает доступ.
- Public water/septic скрывают телефоны, кабинет владельца сохраняет свой контакт.
- Central driver admission отклоняет нового водителя без доступа, trial разрешает его; после expiry назначенный driver_assigned рейс проходит все этапы до completed, водитель освобождается.
- no_driver_found получает срок повторного поиска, выбирается только после наступления срока, логисту не создаются повторные одинаковые уведомления.

Обнаружен и устранён дефект нового output WaterPointOut: inherited input validator отвергал скрытый телефон. Выходной DTO теперь не применяет правила создания к отредактированным публичным контактам. Также скрываются parsed_data/description/crm_comment.

Осталось: все legacy/nested contact surfaces, equipment API/UI, manual/offer/accept сквозные гонки, live API и visual, маршруты нового UI. Этот отчёт не означает готовность этапа 26.4 целиком.
