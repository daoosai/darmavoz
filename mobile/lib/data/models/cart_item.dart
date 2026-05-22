import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:darmavoz_mobile/data/models/material_item.dart';

part 'cart_item.freezed.dart';
part 'cart_item.g.dart';

@freezed
abstract class CartItem with _$CartItem {
  const CartItem._();

  const factory CartItem({
    required String id,
    @JsonKey(name: 'material_id') required String materialId,
    required double volume,
    @JsonKey(name: 'unit_price') double? unitPrice,
    double? amount,
    required MaterialItem material,
  }) = _CartItem;

  factory CartItem.fromJson(Map<String, dynamic> json) => _$CartItemFromJson(json);
}
