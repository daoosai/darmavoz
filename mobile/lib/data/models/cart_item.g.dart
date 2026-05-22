// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'cart_item.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_CartItem _$CartItemFromJson(Map<String, dynamic> json) => _CartItem(
      id: json['id'] as String,
      materialId: json['material_id'] as String,
      volume: (json['volume'] as num).toDouble(),
      unitPrice: (json['unit_price'] as num?)?.toDouble(),
      amount: (json['amount'] as num?)?.toDouble(),
      material: MaterialItem.fromJson(json['material'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$CartItemToJson(_CartItem instance) => <String, dynamic>{
      'id': instance.id,
      'material_id': instance.materialId,
      'volume': instance.volume,
      'unit_price': instance.unitPrice,
      'amount': instance.amount,
      'material': instance.material,
    };
