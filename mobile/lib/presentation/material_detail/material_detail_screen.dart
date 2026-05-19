import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:collection/collection.dart';
import '../../data/models/material_item.dart';
import '../../data/services/api_service.dart';
import '../../data/services/session_service.dart';
import '../providers/cart_provider.dart';

class MaterialDetailScreen extends StatefulWidget {
  final String materialId;
  const MaterialDetailScreen({super.key, required this.materialId});

  @override
  State<MaterialDetailScreen> createState() => _MaterialDetailScreenState();
}

class _MaterialDetailScreenState extends State<MaterialDetailScreen> {
  final ApiService _apiService = ApiService();
  final SessionService _sessionService = SessionService();
  late Future<MaterialItem> _materialFuture;

  @override
  void initState() {
    super.initState();
    _sessionService.init();
    _materialFuture = _fetchMaterial();
  }

  Future<MaterialItem> _fetchMaterial() async {
    return await _apiService.getMaterial(widget.materialId);
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<MaterialItem>(
      future: _materialFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(
            backgroundColor: Colors.white,
            body: Center(child: CircularProgressIndicator()),
          );
        } else if (snapshot.hasError) {
          return Scaffold(
            backgroundColor: Colors.white,
            body: Center(child: Text('Ошибка: ${snapshot.error}')),
          );
        } else if (!snapshot.hasData) {
          return const Scaffold(
            backgroundColor: Colors.white,
            body: Center(child: Text('Материал не найден')),
          );
        }

        final material = snapshot.data!;
        
        final cartProvider = context.watch<CartProvider>();
        final cartItem = cartProvider.cartItems.firstWhereOrNull((item) => item.materialId == material.id);

        return Scaffold(
          backgroundColor: Colors.white,
          body: SafeArea(
            child: Column(
              children: [
                // Кнопка закрытия
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8.0, vertical: 8.0),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      IconButton(
                        icon: const Icon(Icons.close, size: 28),
                        onPressed: () => context.pop(),
                      ),
                    ],
                  ),
                ),
                // Скроллящийся контент
                Expanded(
                  child: SingleChildScrollView(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16.0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // Изображение
                          ClipRRect(
                            borderRadius: BorderRadius.circular(24.0),
                            child: SizedBox(
                              height: 300,
                              width: double.infinity,
                              child: material.imageUrl != null && material.imageUrl!.isNotEmpty
                                  ? Image.network(
                                      material.imageUrl!,
                                      fit: BoxFit.cover,
                                      errorBuilder: (_, __, ___) => _buildPlaceholder(),
                                    )
                                  : _buildPlaceholder(),
                            ),
                          ),
                          const SizedBox(height: 24),
                          // Название
                          Text(
                            material.name,
                            style: const TextStyle(
                              fontSize: 22,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 12),
                          // Минимальный объем
                          Text(
                            'Минимальный объем: ${material.minVolume} ${material.unit}',
                            style: const TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w500,
                              color: Color(0xFF3AA9E1),
                            ),
                          ),
                          const SizedBox(height: 16),
                          // Описание
                          Text(
                            material.description ?? 'Описание отсутствует',
                            style: TextStyle(
                              fontSize: 16,
                              color: Colors.grey.shade700,
                              height: 1.5,
                            ),
                          ),
                          const SizedBox(height: 32),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          bottomNavigationBar: _buildBottomBar(context, material, cartItem, cartProvider),
        );
      },
    );
  }

  Widget _buildBottomBar(BuildContext context, MaterialItem material, dynamic cartItem, CartProvider cartProvider) {
    if (cartItem == null) {
      return Container(
        decoration: BoxDecoration(
          color: Colors.white,
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.05),
              offset: const Offset(0, -4),
              blurRadius: 16,
            ),
          ],
        ),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: SizedBox(
              width: double.infinity,
              height: 56,
              child: ElevatedButton(
                onPressed: () async {
                  try {
                    await cartProvider.addToCart(_sessionService.sessionKey, material, material.minVolume);
                  } catch (e) {
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text(cartProvider.error ?? 'Ошибка')),
                      );
                    }
                  }
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF3AA9E1),
                  shape: const StadiumBorder(),
                  elevation: 0,
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      '${material.price ?? 0} ₽ / ${material.unit}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const Text(
                      'В корзину',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    }

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            offset: const Offset(0, -4),
            blurRadius: 16,
          ),
        ],
      ),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            children: [
              // Счетчик
              Container(
                height: 56,
                decoration: ShapeDecoration(
                  shape: StadiumBorder(
                    side: BorderSide(color: Colors.grey.shade300),
                  ),
                ),
                child: Row(
                  children: [
                    IconButton(
                      icon: const Icon(Icons.remove),
                      onPressed: () async {
                        try {
                          if (cartItem.volume <= material.minVolume) {
                            await cartProvider.removeFromCart(_sessionService.sessionKey, cartItem.id);
                          } else {
                            await cartProvider.updateVolume(_sessionService.sessionKey, cartItem.id, cartItem.volume - 1.0);
                          }
                        } catch (e) {
                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text(cartProvider.error ?? 'Ошибка')),
                            );
                          }
                        }
                      },
                      color: Colors.black87,
                    ),
                    Text(
                      '${cartItem.volume}',
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.add),
                      onPressed: () async {
                        try {
                          await cartProvider.updateVolume(_sessionService.sessionKey, cartItem.id, cartItem.volume + 1.0);
                        } catch (e) {
                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text(cartProvider.error ?? 'Ошибка')),
                            );
                          }
                        }
                      },
                      color: Colors.black87,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              // Кнопка перехода
              Expanded(
                child: SizedBox(
                  height: 56,
                  child: ElevatedButton(
                    onPressed: () {
                      context.go('/cart');
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF3AA9E1),
                      shape: const StadiumBorder(),
                      elevation: 0,
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          '${cartItem.amount ?? 0} ₽',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        Badge(
                          label: Text(cartProvider.cartItems.length.toString()),
                          child: const Icon(
                            Icons.shopping_cart_outlined,
                            color: Colors.white,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildPlaceholder() {
    return Container(
      color: Colors.grey.shade200,
      child: Icon(
        Icons.image_outlined,
        size: 80,
        color: Colors.grey.shade400,
      ),
    );
  }
}
