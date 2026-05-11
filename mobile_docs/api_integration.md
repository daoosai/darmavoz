# Интеграция с API (Сетевой слой)

## 1. Базовый URL
Для выполнения запросов используется класс `ApiService` (`mobile/lib/data/services/api_service.dart`).
Паттерн выбора URL реализован с учетом среды выполнения (через константу `kIsWeb` и проверку `Platform.isAndroid`):
- Если приложение запущено в Web-версии (например, Flutter Web): используется `http://127.0.0.1:8000`.
- Если приложение запущено на Android-эмуляторе: используется `http://10.0.2.2:8000` (так как 127.0.0.1 для эмулятора — это сам эмулятор, а 10.0.2.2 — это хост-машина).
- Для остальных случаев (iOS-симулятор) по умолчанию пока остается `http://127.0.0.1:8000`.

*Примечание:* В бэкенде (FastAPI) в `main.py` настроен `CORSMiddleware` с `allow_origins=["*"]`, чтобы Web-версия Flutter могла получать данные без ошибок CORS.

## 2. Модель Product
Сгенерирована с использованием пакетов `freezed` и `json_serializable`. Находится в `mobile/lib/data/models/product.dart`.

**Структура полей:**
- `id` (String) — Уникальный UUID.
- `name` (String) — Название (например, "Песок строительный").
- `description` (String) — Описание товара.
- `price` (double) — Цена.
- `unitType` (String) — Единица измерения. В JSON от бэкенда приходит как `unit_type` (используется `@JsonKey(name: 'unit_type')`).
- `imageUrl` (String) — Ссылка на изображение. В JSON приходит как `image_url`.

## 3. Стейт-менеджмент (Экран Каталога)
На экране `/home` (`HomeScreen`) используется паттерн управления состоянием через `StatefulWidget` + `FutureBuilder`.

**Как это работает:**
1. При инициализации виджета (`initState`) вызывается метод `_fetchProducts()`, который сохраняет результат вызова `_apiService.getProducts()` в переменную `_productsFuture`.
2. В методе `build` используется `FutureBuilder<List<Product>>`.
3. Реализованы 3 состояния UI:
   - **Загрузка:** Пока `snapshot.connectionState == ConnectionState.waiting`, отображается `CircularProgressIndicator`.
   - **Ошибка:** Если `snapshot.hasError` (например, сервер недоступен), отображается иконка ошибки, текст и кнопка "Повторить", которая заново вызывает `_fetchProducts()` (вызывая `setState`).
   - **Успех:** Если данные получены, строится `GridView.builder`, который рендерит переиспользуемый виджет `ProductCardWidget`, передавая в него объект `Product`.
