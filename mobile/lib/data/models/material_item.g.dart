// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'material_item.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_MaterialItem _$MaterialItemFromJson(Map<String, dynamic> json) =>
    _MaterialItem(
      id: json['id'] as String,
      categoryId: json['category_id'] as String,
      name: json['name'] as String,
      description: json['description'] as String?,
      price: (json['price'] as num?)?.toDouble(),
      unit: json['unit'] as String,
      minVolume: (json['min_volume'] as num).toDouble(),
      imageUrl: json['image_url'] as String?,
      isActive: json['is_active'] as bool,
    );

Map<String, dynamic> _$MaterialItemToJson(_MaterialItem instance) =>
    <String, dynamic>{
      'id': instance.id,
      'category_id': instance.categoryId,
      'name': instance.name,
      'description': instance.description,
      'price': instance.price,
      'unit': instance.unit,
      'min_volume': instance.minVolume,
      'image_url': instance.imageUrl,
      'is_active': instance.isActive,
    };
