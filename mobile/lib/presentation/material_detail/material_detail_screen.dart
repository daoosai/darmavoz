import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../data/models/material_item.dart';
import '../../data/services/api_service.dart';
import '../../data/services/session_service.dart';

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
  double _volume = 1.0;

  @override
  void initState() {
    super.initState();
    _sessionService.init();
    _materialFuture = _fetchMaterial();
  }

  Future<MaterialItem> _fetchMaterial() async {
    // В реальном приложении здесь был бы запрос к API для получения одного материала
    // но так как у нас уже есть список, мы можем найти его там
    // Это упрощение для примера
    final materials = await _apiService.getMaterials();
    final material = materials.firstWhere((m) => m.id == widget.materialId);
    setState(() {
      _volume = material.minVolume;
    });
    return material;
  }

  void _updateVolume(double newVolume, double minVolume) {
    if (newVolume >= minVolume) {
      setState(() {
        _volume = newVolume;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Карточка товара')),
      body: FutureBuilder<MaterialItem>(
        future: _materialFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          } else if (snapshot.hasError) {
            return Center(child: Text('Ошибка: ${snapshot.error}'));
          } else if (!snapshot.hasData) {
            return const Center(child: Text('Материал не найден'));
          }

          final material = snapshot.data!;
          final total = material.price != null ? _volume * material.price! : 0.0;

          return Column(
            children: [
              Expanded(
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _buildImage(material),
                      _buildInfo(material),
                    ],
                  ),
                ),
              ),
              _buildBottomBar(material, total),
            ],
          );
        },
      ),
    );
  }

  Widget _buildImage(MaterialItem material) {
    return AspectRatio(
      aspectRatio: 16 / 9,
      child: Container(
        width: double.infinity,
        color: Colors.grey.shade200,
        child: material.imageUrl != null
            ? Image.network(
                material.imageUrl!,
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) => const Icon(Icons.error),
              )
            : const Icon(Icons.image, size: 100, color: Colors.grey),
      ),
    );
  }

  Widget _buildInfo(MaterialItem material) {
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(material.name, style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 8),
          Text(material.description ?? 'Описание отсутствует', style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: 16),
          Text('Минимальный объем: ${material.minVolume} ${material.unit}', style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 24),
          _buildVolumeController(material),
        ],
      ),
    );
  }

  Widget _buildVolumeController(MaterialItem material) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        IconButton(
          icon: const Icon(Icons.remove_circle_outline),
          onPressed: () => _updateVolume(_volume - 1, material.minVolume),
        ),
        SizedBox(
          width: 80,
          child: TextField(
            controller: TextEditingController(text: _volume.toString()),
            textAlign: TextAlign.center,
            keyboardType: TextInputType.number,
            onSubmitted: (value) => _updateVolume(double.tryParse(value) ?? material.minVolume, material.minVolume),
          ),
        ),
        IconButton(
          icon: const Icon(Icons.add_circle_outline),
          onPressed: () => _updateVolume(_volume + 1, material.minVolume),
        ),
      ],
    );
  }

  Widget _buildBottomBar(MaterialItem material, double total) {
    return Container(
      padding: const EdgeInsets.all(16.0),
      decoration: BoxDecoration(
        color: Colors.white,
        boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.1), blurRadius: 10)],
      ),
      child: SafeArea(
        child: ElevatedButton(
          style: ElevatedButton.styleFrom(
            minimumSize: const Size(double.infinity, 50),
          ),
          onPressed: () async {
            try {
              await _apiService.addCartItem(_sessionService.sessionKey, material.id, _volume);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Добавлено в корзину')),
              );
              context.pop();
            } catch (e) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('Ошибка: $e')),
              );
            }
          },
          child: Text('Добавить в корзину (Итого: ${total.toStringAsFixed(2)} руб)'),
        ),
      ),
    );
  }
}
