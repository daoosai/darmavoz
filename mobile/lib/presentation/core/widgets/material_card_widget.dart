import 'package:flutter/material.dart';
import 'package:darmavoz_mobile/data/models/material_item.dart';

class MaterialCardWidget extends StatelessWidget {
  final MaterialItem material;
  final VoidCallback onTap;
  final double initialVolume;
  final VoidCallback onAddToCart;
  final Function(double) onUpdateVolume;
  final VoidCallback onDeleteFromCart;

  const MaterialCardWidget({
    super.key,
    required this.material,
    required this.onTap,
    this.initialVolume = 0.0,
    required this.onAddToCart,
    required this.onUpdateVolume,
    required this.onDeleteFromCart,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.05),
              blurRadius: 8,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: ClipRRect(
                borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
                child: Container(
                  width: double.infinity,
                  color: const Color(0xFFE0E0E0),
                  child: material.imageUrl != null && material.imageUrl!.isNotEmpty
                      ? Image.network(
                          material.imageUrl!,
                          fit: BoxFit.cover,
                          loadingBuilder: (context, child, progress) {
                            return progress == null ? child : const Center(child: CircularProgressIndicator());
                          },
                          errorBuilder: (context, error, stackTrace) {
                            return Container(
                              color: Colors.grey.shade200,
                              child: const Icon(Icons.image_not_supported, size: 40, color: Colors.grey),
                            );
                          },
                        )
                      : Container(
                          color: Colors.grey.shade200,
                          child: const Icon(Icons.image_not_supported, size: 40, color: Colors.grey),
                        ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(12.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    material.name,
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 8),
                  if (material.price != null)
                    Text(
                      'от ${material.price} руб/${material.unit}',
                      style: TextStyle(color: Colors.grey.shade600, fontSize: 13),
                    ),
                  const SizedBox(height: 12),
                  if (initialVolume == 0)
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: onAddToCart,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF3AA9E1),
                          foregroundColor: Colors.white,
                          elevation: 0,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                          padding: const EdgeInsets.symmetric(vertical: 8),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            if (material.price != null)
                              Text('${material.price} ₽', style: const TextStyle(fontWeight: FontWeight.bold)),
                            if (material.price != null)
                              const SizedBox(width: 8),
                            const Icon(
                              Icons.shopping_cart,
                              color: Colors.white,
                              size: 20,
                            ),
                          ],
                        ),
                      ),
                    )
                  else
                    Container(
                      decoration: BoxDecoration(
                        color: Colors.grey.shade100,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          InkWell(
                            onTap: () {
                              if (initialVolume <= material.minVolume) {
                                onDeleteFromCart();
                              } else {
                                onUpdateVolume(initialVolume - 1.0);
                              }
                            },
                            child: const Padding(
                              padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              child: Text('-', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                            ),
                          ),
                          Text('$initialVolume', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
                          InkWell(
                            onTap: () => onUpdateVolume(initialVolume + 1.0),
                            child: const Padding(
                              padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              child: Text('+', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
