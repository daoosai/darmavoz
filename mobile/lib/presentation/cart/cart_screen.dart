import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../data/models/cart_item.dart';
import '../../data/services/session_service.dart';
import '../providers/cart_provider.dart';

class CartScreen extends StatefulWidget {
  const CartScreen({super.key});

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  final SessionService _sessionService = SessionService();

  @override
  void initState() {
    super.initState();
    _sessionService.init().then((_) {
      if (mounted) {
        context.read<CartProvider>().fetchCart(_sessionService.sessionKey);
      }
    });
  }

  Future<void> _updateVolume(CartItem item, double newVolume) async {
    if (newVolume < item.material.minVolume) return;
    try {
      await context.read<CartProvider>().updateVolume(_sessionService.sessionKey, item.id, newVolume);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(context.read<CartProvider>().error ?? 'Ошибка')));
      }
    }
  }

  Future<void> _deleteItem(CartItem item) async {
    try {
      await context.read<CartProvider>().removeFromCart(_sessionService.sessionKey, item.id);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(context.read<CartProvider>().error ?? 'Ошибка')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final cartProvider = context.watch<CartProvider>();
    final isLoading = cartProvider.isLoading;
    final items = cartProvider.cartItems;
    final error = cartProvider.error;
    final totalAmount = cartProvider.totalAmount;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Корзина'),
        centerTitle: true,
        backgroundColor: Colors.white,
        foregroundColor: Colors.black,
        elevation: 2,
        shadowColor: Colors.black.withOpacity(0.2),
      ),
      body: isLoading && items.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : error != null && items.isEmpty
              ? Center(child: Text(error))
              : items.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            'Добавьте товары в корзину',
                            style: TextStyle(fontSize: 18, color: Colors.grey.shade700),
                          ),
                          const SizedBox(height: 16),
                          ElevatedButton(
                            onPressed: () {
                              context.go('/home');
                            },
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.blue,
                              foregroundColor: Colors.white,
                            ),
                            child: const Text('К списку товаров'),
                          ),
                        ],
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.all(16),
                      itemCount: items.length,
                      separatorBuilder: (context, index) => const SizedBox(height: 12),
                      itemBuilder: (context, index) {
                        final item = items[index];
                        return _buildCartItem(item);
                      },
                    ),
      bottomNavigationBar: items.isEmpty
          ? const SizedBox.shrink()
          : _buildBottomBar(totalAmount),
    );
  }

  Widget _buildCartItem(CartItem item) {
    final material = item.material;
    return Container(
      margin: const EdgeInsets.only(bottom: 2),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.grey.shade200),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ЛЕВЫЙ БЛОК (Картинка)
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: SizedBox(
                width: 60,
                height: 80,
                child: material.imageUrl != null && material.imageUrl!.isNotEmpty
                    ? Image.network(
                        material.imageUrl!,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => Container(
                          color: Colors.grey.shade200,
                          child: const Icon(Icons.image_not_supported, color: Colors.grey),
                        ),
                      )
                    : Container(
                        color: Colors.grey.shade200,
                        child: const Icon(Icons.image_not_supported, color: Colors.grey),
                      ),
              ),
            ),
            const SizedBox(width: 12),
            // ПРАВЫЙ БЛОК
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // ВЕРХНЯЯ СТРОКА
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(
                          material.name,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                        ),
                      ),
                      GestureDetector(
                        onTap: () => _deleteItem(item),
                        child: const Icon(Icons.close, color: Colors.grey, size: 24),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  // ПОДЗАГОЛОВОК
                  Text(
                    '${item.unitPrice ?? 0} ₽ за 1 ${material.unit}',
                    style: TextStyle(color: Colors.grey.shade600, fontSize: 13),
                  ),
                  const SizedBox(height: 12),
                  // НИЖНЯЯ СТРОКА
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Сумма:', style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
                          Text(
                            '${item.amount ?? 0} ₽',
                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                          ),
                        ],
                      ),
                      const Spacer(),
                      // КОНТРОЛЛЕР ОБЪЕМА
                      Container(
                        decoration: ShapeDecoration(
                          shape: StadiumBorder(
                            side: BorderSide(color: Colors.grey.shade300),
                          ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            IconButton(
                              icon: const Icon(Icons.remove, size: 20),
                              padding: EdgeInsets.zero,
                              constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                              onPressed: () {
                                if (item.volume <= material.minVolume) {
                                  _deleteItem(item);
                                } else {
                                  _updateVolume(item, item.volume - 1.0);
                                }
                              },
                              color: Colors.grey.shade700,
                            ),
                            Text(
                              '${item.volume}',
                              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
                            ),
                            IconButton(
                              icon: const Icon(Icons.add, size: 20),
                              padding: EdgeInsets.zero,
                              constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                              onPressed: () => _updateVolume(item, item.volume + 1.0),
                              color: const Color(0xFF3AA9E1),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBottomBar(double totalAmount) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 10,
            offset: const Offset(0, -4),
          ),
        ],
      ),
      child: SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Итого к оплате', style: TextStyle(fontSize: 16)),
                Text(
                  '${totalAmount.toStringAsFixed(2)} руб',
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                ),
              ],
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              height: 50,
              child: ElevatedButton(
                onPressed: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Переход к оформлению заказа...')),
                  );
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.blue,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                child: const Text('Перейти к оформлению', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

