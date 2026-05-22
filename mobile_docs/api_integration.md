# Интеграция с API (Сетевой слой)

## 1. Базовый URL
Для выполнения запросов используется класс `ApiService` (`mobile/lib/data/services/api_service.dart`).
Паттерн выбора URL реализован с учетом среды выполнения:
- **Release**: `https://darmavoz.ru`
- **Debug (Web)**: `http://localhost:8000`
- **Debug (Android/iOS)**: `http://10.0.2.2:8000`

## 2. Модели данных (Freezed)
Модели сгенерированы с использованием `freezed` и `json_serializable`.

### Category (`category.dart`)
- `id` (String)
- `name` (String)
- `slug` (String)
- `sortOrder` (int)
- `isActive` (bool)

### MaterialItem (`material_item.dart`)
- `id` (String)
- `categoryId` (String)
- `name` (String)
- `description` (String?)
- `price` (double?)
- `unit` (String)
- `minVolume` (double)
- `imageUrl` (String?)
- `isActive` (bool)

### CartItem (`cart_item.dart`)
- `id` (String)
- `materialId` (String)
- `volume` (double)
- `unitPrice` (double?)
- `amount` (double?)
- `material` (MaterialItem) - вложенный объект

## 3. ApiService
Находится в `mobile/lib/data/services/api_service.dart`.

### Методы каталога:
- `Future<List<Category>> getCategories()`: Запрос на `GET /api/v1/catalog/categories/`.
- `Future<List<MaterialItem>> getMaterials({String? categoryId})`: Запрос на `GET /api/v1/catalog/materials/` с опциональным query-параметром `category_id`.

### Методы корзины:
- `Future<List<CartItem>> getCartItems(String sessionKey)`: Запрос на `GET /api/v1/cart/` с передачей `session_key` в заголовках.
- `Future<void> addCartItem(String sessionKey, String materialId, double volume)`: Запрос `POST /api/v1/cart/items`.
- `Future<void> updateCartItem(String itemId, double volume)`: Запрос `PATCH /api/v1/cart/items/{itemId}`.
- `Future<void> deleteCartItem(String itemId)`: Запрос `DELETE /api/v1/cart/items/{itemId}`.

## 4. SessionService
Сервис `SessionService` (`mobile/lib/data/services/session_service.dart`) отвечает за управление анонимной сессией пользователя для привязки к корзине.
- При первом запуске генерирует `UUIDv4` и сохраняет его в `SharedPreferences`.
- При последующих запусках использует сохраненный ключ.
- Ключ `sessionKey` доступен через свойство сервиса и передается в заголовках запросов к API корзины.
