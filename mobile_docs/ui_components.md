# UI Компоненты и Верстка

## Структура экрана Home (Каталог)

Экран `/home` (`mobile/lib/presentation/home/home_screen.dart`) был полностью переработан для работы с новыми API каталога.

**Дерево виджетов экрана Home:**
- `Scaffold`
  - `SafeArea`
    - `Column`
      - **Верхний блок:** `Padding` -> `InkWell` -> `Container` (Синяя плашка-кнопка "Укажите адрес доставки").
      - **Поиск:** `Padding` -> `TextField`.
      - **Категории:** `SizedBox` -> `FutureBuilder<List<Category>>` -> `ListView.separated` (Горизонтальный список `ChoiceChip`, который строится динамически на основе данных из `apiService.getCategories()`. Добавлена опция "Все").
      - **Сетка материалов:** `Expanded` -> `FutureBuilder<List<MaterialItem>>` -> `GridView.builder`.
        - `Future` для `FutureBuilder` меняется в зависимости от выбранной категории.
        - `MaterialCardWidget` (Новая карточка материала).

## Экран Карточки Товара (Material Detail)

**Расположение:** `mobile/lib/presentation/material_detail/material_detail_screen.dart`

Новый экран, который открывается по маршруту `/home/material/:id`.

**Особенности реализации:**
- **Получение данных:** Экран принимает `materialId` и использует `ApiService` для получения полной информации о материале.
- **Верстка:**
  - `AppBar` с заголовком.
  - `Column` с `SingleChildScrollView` для контента и закрепленной нижней панелью.
  - **Изображение:** `AspectRatio` с `Image.network` и плейсхолдером.
  - **Информация:** Название, описание, минимальный объем.
  - **Контроллер объема:** `Row` с `IconButton` (`-`/`+`) и `TextField` для ручного ввода. Не позволяет установить значение меньше `minVolume`.
  - **Нижняя панель:** `Container` с тенью, содержащий `ElevatedButton` "Добавить в корзину" с динамическим расчетом итоговой стоимости.
- **Логика:** При нажатии на кнопку вызывается `apiService.addCartItem`, после чего показывается `SnackBar` и происходит возврат на предыдущий экран (`context.pop()`).

## Переиспользуемые виджеты

### MaterialCardWidget
**Расположение:** `mobile/lib/presentation/core/widgets/material_card_widget.dart`

Новый виджет для отображения карточки материала в сетке.

**Особенности реализации:**
- Принимает объект `MaterialItem`.
- Отображает изображение, название и цену в формате "от X руб/unit".
- При нажатии выполняет `onTap`, который в `HomeScreen` осуществляет переход на `MaterialDetailScreen`.
