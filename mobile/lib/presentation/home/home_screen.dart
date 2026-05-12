import 'package:flutter/material.dart';
import '../../data/models/product.dart';
import '../../data/services/api_service.dart';
import '../../data/services/update_service.dart';
import '../core/widgets/product_card_widget.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final ApiService _apiService = ApiService();
  late Future<List<Product>> _productsFuture;
  
  String _searchQuery = '';
  String _selectedCategory = 'Все';

  @override
  void initState() {
    super.initState();
    _fetchProducts();
    
    // Проверка обновлений при старте главного экрана
    WidgetsBinding.instance.addPostFrameCallback((_) {
      UpdateService(_apiService).checkForUpdates(context);
    });
  }

  void _fetchProducts() {
    setState(() {
      _productsFuture = _apiService.getProducts();
    });
  }

  @override
  Widget build(BuildContext context) {
    final categories = ['Все', 'Песок', 'Щебень', 'Грунт', 'Керамзит'];

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            // 1. Верхний блок: Синяя плашка-кнопка "Укажите адрес доставки"
            Padding(
              padding: const EdgeInsets.all(16.0),
              child: InkWell(
                onTap: () {
                  // TODO: Открытие выбора адреса
                },
                borderRadius: BorderRadius.circular(16),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                  decoration: BoxDecoration(
                    color: const Color(0xFF38A3D1), // Синий цвет как на скрине
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.location_on_outlined, color: Colors.white),
                      SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          'Укажите адрес доставки',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 16,
                            fontWeight: FontWeight.w500,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),

            // 1.5. Поиск
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16.0),
              child: TextField(
                onChanged: (value) {
                  setState(() {
                    _searchQuery = value;
                  });
                },
                decoration: InputDecoration(
                  hintText: 'Поиск...',
                  prefixIcon: const Icon(Icons.search),
                  filled: true,
                  fillColor: Colors.grey.shade200,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide.none,
                  ),
                  contentPadding: const EdgeInsets.symmetric(vertical: 0),
                ),
              ),
            ),
            const SizedBox(height: 16),
            
            // 2. Категории (Chips/Tabs)
            SizedBox(
              height: 40,
              child: ListView.separated(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                scrollDirection: Axis.horizontal,
                itemCount: categories.length,
                separatorBuilder: (context, index) => const SizedBox(width: 8),
                itemBuilder: (context, index) {
                  final isSelected = _selectedCategory == categories[index];
                  return ChoiceChip(
                    label: Text(categories[index]),
                    selected: isSelected,
                    showCheckmark: false,
                    onSelected: (bool selected) {
                      setState(() {
                        _selectedCategory = categories[index];
                      });
                    },
                    selectedColor: Colors.white,
                    backgroundColor: Colors.transparent,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(20),
                      side: BorderSide(
                        color: isSelected ? Colors.transparent : Colors.grey.shade300,
                      ),
                    ),
                    elevation: isSelected ? 2 : 0,
                    labelStyle: TextStyle(
                      color: isSelected ? Colors.black : Colors.grey.shade600,
                      fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                    ),
                  );
                },
              ),
            ),
            
            const SizedBox(height: 16),
            
            // 3. Сетка товаров
            Expanded(
              child: FutureBuilder<List<Product>>(
                future: _productsFuture,
                builder: (context, snapshot) {
                  if (snapshot.connectionState == ConnectionState.waiting) {
                    return const Center(
                      child: CircularProgressIndicator(),
                    );
                  } else if (snapshot.hasError) {
                    return Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.error_outline, size: 48, color: Colors.red),
                          const SizedBox(height: 16),
                          const Text('Ошибка загрузки данных', style: TextStyle(fontSize: 16)),
                          const SizedBox(height: 16),
                          ElevatedButton(
                            onPressed: _fetchProducts,
                            child: const Text('Повторить'),
                          ),
                        ],
                      ),
                    );
                  } else if (!snapshot.hasData || snapshot.data!.isEmpty) {
                    return const Center(
                      child: Text('Товары не найдены', style: TextStyle(fontSize: 16)),
                    );
                  }

                  var products = snapshot.data!;

                  // Применяем фильтрацию по категории
                  if (_selectedCategory != 'Все') {
                    products = products.where((product) {
                      return product.name.toLowerCase().contains(_selectedCategory.toLowerCase());
                    }).toList();
                  }

                  // Применяем фильтрацию по поисковому запросу
                  if (_searchQuery.isNotEmpty) {
                    products = products.where((product) {
                      return product.name.toLowerCase().contains(_searchQuery.toLowerCase());
                    }).toList();
                  }

                  if (products.isEmpty) {
                    return const Center(
                      child: Text('Ничего не найдено', style: TextStyle(fontSize: 16)),
                    );
                  }

                  return GridView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                      maxCrossAxisExtent: 300,
                      mainAxisSpacing: 16,
                      crossAxisSpacing: 16,
                      childAspectRatio: 0.55, // Адаптировано для контроллера объема и кнопки корзины
                    ),
                    itemCount: products.length,
                    itemBuilder: (context, index) {
                      final product = products[index];
                      return ProductCardWidget(
                        product: product,
                      );
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
