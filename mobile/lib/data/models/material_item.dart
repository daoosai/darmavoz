import 'package:freezed_annotation/freezed_annotation.dart';

part 'material_item.freezed.dart';
part 'material_item.g.dart';

@freezed
abstract class MaterialItem with _$MaterialItem {
  const MaterialItem._();

  const factory MaterialItem({
    required String id,
    @JsonKey(name: 'category_id') required String categoryId,
    required String name,
    String? description,
    double? price,
    required String unit,
    @JsonKey(name: 'min_volume') required double minVolume,
    @JsonKey(name: 'image_url') String? imageUrl,
    @JsonKey(name: 'is_active') required bool isActive,
  }) = _MaterialItem;

  factory MaterialItem.fromJson(Map<String, dynamic> json) => _$MaterialItemFromJson(json);
}
