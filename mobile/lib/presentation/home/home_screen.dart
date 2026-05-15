import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../data/models/category.dart' as app_models;
import '../../data/models/material_item.dart';
import '../../data/services/api_service.dart';
import '../../data/services/update_service.dart';
import '../core/widgets/material_card_widget.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final ApiService _apiService = ApiService();
  late Future<List<app_models.Category>> _categoriesFuture;
  late Future<List<MaterialItem>> _materialsFuture;

  String _searchQuery = '';
  String? _selectedCategoryId;

  @override
  void initState() {
    super.initState();
    _fetchCategories();
    _fetchMaterials();

    WidgetsBinding.instance.addPostFrameCallback((_) {
      UpdateService(_apiService).checkForUpdates(context);
    });
  }

  void _fetchCategories() {
    setState(() {
      _categoriesFuture = _apiService.getCategories();
    });
  }

  void _fetchMaterials({String? categoryId}) {
    setState(() {
      _materialsFuture = _apiService.getMaterials(categoryId: categoryId);
      _selectedCategoryId = categoryId;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            _buildHeader(),
            _buildSearch(),
            const SizedBox(height: 16),
            _buildCategoryChips(),
            const SizedBox(height: 16),
            _buildMaterialsGrid(),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: InkWell(
        onTap: () {},
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
          decoration: BoxDecoration(
            color: const Color(0xFF38A3D1),
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
    );
  }

  Widget _buildSearch() {
    return Padding(
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
    );
  }

  Widget _buildCategoryChips() {
    return SizedBox(
      height: 40,
      child: FutureBuilder<List<app_models.Category>>(
        future: _categoriesFuture,
        builder: (context, snapshot) {
          if (!snapshot.hasData) {
            return const Center(child: SizedBox.shrink());
          }
          final categories = [app_models.Category(id: 'all', name: 'Все', slug: 'all', sortOrder: -1, isActive: true), ...snapshot.data!];
          return ListView.separated(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            scrollDirection: Axis.horizontal,
            itemCount: categories.length,
            separatorBuilder: (context, index) => const SizedBox(width: 8),
            itemBuilder: (context, index) {
              final category = categories[index];
              final isSelected = (_selectedCategoryId == null && category.id == 'all') || _selectedCategoryId == category.id;
              return ChoiceChip(
                label: Text(category.name),
                selected: isSelected,
                showCheckmark: false,
                onSelected: (bool selected) {
                  _fetchMaterials(categoryId: category.id == 'all' ? null : category.id);
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
          );
        },
      ),
    );
  }

  Widget _buildMaterialsGrid() {
    return Expanded(
      child: FutureBuilder<List<MaterialItem>>(
        future: _materialsFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
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
                    onPressed: () => _fetchMaterials(categoryId: _selectedCategoryId),
                    child: const Text('Повторить'),
                  ),
                ],
              ),
            );
          } else if (!snapshot.hasData || snapshot.data!.isEmpty) {
            return const Center(child: Text('Товары не найдены', style: TextStyle(fontSize: 16)));
          }

          var materials = snapshot.data!;

          if (_searchQuery.isNotEmpty) {
            materials = materials.where((material) {
              return material.name.toLowerCase().contains(_searchQuery.toLowerCase());
            }).toList();
          }

          if (materials.isEmpty) {
            return const Center(child: Text('Ничего не найдено', style: TextStyle(fontSize: 16)));
          }

          return GridView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                      maxCrossAxisExtent: 300,
                      mainAxisSpacing: 16,
                      crossAxisSpacing: 16,
                      childAspectRatio: 0.65,
                    ),
            itemCount: materials.length,
            itemBuilder: (context, index) {
              final material = materials[index];
              return MaterialCardWidget(
                material: material,
                onTap: () => context.go('/home/material/${material.id}'),
              );
            },
          );
        },
      ),
    );
  }
}
