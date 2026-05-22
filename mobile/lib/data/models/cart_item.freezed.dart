// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'cart_item.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$CartItem {
  String get id;
  @JsonKey(name: 'material_id')
  String get materialId;
  double get volume;
  @JsonKey(name: 'unit_price')
  double? get unitPrice;
  double? get amount;
  MaterialItem get material;

  /// Create a copy of CartItem
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $CartItemCopyWith<CartItem> get copyWith =>
      _$CartItemCopyWithImpl<CartItem>(this as CartItem, _$identity);

  /// Serializes this CartItem to a JSON map.
  Map<String, dynamic> toJson();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is CartItem &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.materialId, materialId) ||
                other.materialId == materialId) &&
            (identical(other.volume, volume) || other.volume == volume) &&
            (identical(other.unitPrice, unitPrice) ||
                other.unitPrice == unitPrice) &&
            (identical(other.amount, amount) || other.amount == amount) &&
            (identical(other.material, material) ||
                other.material == material));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
      runtimeType, id, materialId, volume, unitPrice, amount, material);

  @override
  String toString() {
    return 'CartItem(id: $id, materialId: $materialId, volume: $volume, unitPrice: $unitPrice, amount: $amount, material: $material)';
  }
}

/// @nodoc
abstract mixin class $CartItemCopyWith<$Res> {
  factory $CartItemCopyWith(CartItem value, $Res Function(CartItem) _then) =
      _$CartItemCopyWithImpl;
  @useResult
  $Res call(
      {String id,
      @JsonKey(name: 'material_id') String materialId,
      double volume,
      @JsonKey(name: 'unit_price') double? unitPrice,
      double? amount,
      MaterialItem material});

  $MaterialItemCopyWith<$Res> get material;
}

/// @nodoc
class _$CartItemCopyWithImpl<$Res> implements $CartItemCopyWith<$Res> {
  _$CartItemCopyWithImpl(this._self, this._then);

  final CartItem _self;
  final $Res Function(CartItem) _then;

  /// Create a copy of CartItem
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? materialId = null,
    Object? volume = null,
    Object? unitPrice = freezed,
    Object? amount = freezed,
    Object? material = null,
  }) {
    return _then(_self.copyWith(
      id: null == id
          ? _self.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      materialId: null == materialId
          ? _self.materialId
          : materialId // ignore: cast_nullable_to_non_nullable
              as String,
      volume: null == volume
          ? _self.volume
          : volume // ignore: cast_nullable_to_non_nullable
              as double,
      unitPrice: freezed == unitPrice
          ? _self.unitPrice
          : unitPrice // ignore: cast_nullable_to_non_nullable
              as double?,
      amount: freezed == amount
          ? _self.amount
          : amount // ignore: cast_nullable_to_non_nullable
              as double?,
      material: null == material
          ? _self.material
          : material // ignore: cast_nullable_to_non_nullable
              as MaterialItem,
    ));
  }

  /// Create a copy of CartItem
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $MaterialItemCopyWith<$Res> get material {
    return $MaterialItemCopyWith<$Res>(_self.material, (value) {
      return _then(_self.copyWith(material: value));
    });
  }
}

/// Adds pattern-matching-related methods to [CartItem].
extension CartItemPatterns on CartItem {
  /// A variant of `map` that fallback to returning `orElse`.
  ///
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case final Subclass value:
  ///     return ...;
  ///   case _:
  ///     return orElse();
  /// }
  /// ```

  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>(
    TResult Function(_CartItem value)? $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _CartItem() when $default != null:
        return $default(_that);
      case _:
        return orElse();
    }
  }

  /// A `switch`-like method, using callbacks.
  ///
  /// Callbacks receives the raw object, upcasted.
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case final Subclass value:
  ///     return ...;
  ///   case final Subclass2 value:
  ///     return ...;
  /// }
  /// ```

  @optionalTypeArgs
  TResult map<TResult extends Object?>(
    TResult Function(_CartItem value) $default,
  ) {
    final _that = this;
    switch (_that) {
      case _CartItem():
        return $default(_that);
      case _:
        throw StateError('Unexpected subclass');
    }
  }

  /// A variant of `map` that fallback to returning `null`.
  ///
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case final Subclass value:
  ///     return ...;
  ///   case _:
  ///     return null;
  /// }
  /// ```

  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>(
    TResult? Function(_CartItem value)? $default,
  ) {
    final _that = this;
    switch (_that) {
      case _CartItem() when $default != null:
        return $default(_that);
      case _:
        return null;
    }
  }

  /// A variant of `when` that fallback to an `orElse` callback.
  ///
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case Subclass(:final field):
  ///     return ...;
  ///   case _:
  ///     return orElse();
  /// }
  /// ```

  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>(
    TResult Function(
            String id,
            @JsonKey(name: 'material_id') String materialId,
            double volume,
            @JsonKey(name: 'unit_price') double? unitPrice,
            double? amount,
            MaterialItem material)?
        $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _CartItem() when $default != null:
        return $default(_that.id, _that.materialId, _that.volume,
            _that.unitPrice, _that.amount, _that.material);
      case _:
        return orElse();
    }
  }

  /// A `switch`-like method, using callbacks.
  ///
  /// As opposed to `map`, this offers destructuring.
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case Subclass(:final field):
  ///     return ...;
  ///   case Subclass2(:final field2):
  ///     return ...;
  /// }
  /// ```

  @optionalTypeArgs
  TResult when<TResult extends Object?>(
    TResult Function(
            String id,
            @JsonKey(name: 'material_id') String materialId,
            double volume,
            @JsonKey(name: 'unit_price') double? unitPrice,
            double? amount,
            MaterialItem material)
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _CartItem():
        return $default(_that.id, _that.materialId, _that.volume,
            _that.unitPrice, _that.amount, _that.material);
      case _:
        throw StateError('Unexpected subclass');
    }
  }

  /// A variant of `when` that fallback to returning `null`
  ///
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case Subclass(:final field):
  ///     return ...;
  ///   case _:
  ///     return null;
  /// }
  /// ```

  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>(
    TResult? Function(
            String id,
            @JsonKey(name: 'material_id') String materialId,
            double volume,
            @JsonKey(name: 'unit_price') double? unitPrice,
            double? amount,
            MaterialItem material)?
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _CartItem() when $default != null:
        return $default(_that.id, _that.materialId, _that.volume,
            _that.unitPrice, _that.amount, _that.material);
      case _:
        return null;
    }
  }
}

/// @nodoc
@JsonSerializable()
class _CartItem extends CartItem {
  const _CartItem(
      {required this.id,
      @JsonKey(name: 'material_id') required this.materialId,
      required this.volume,
      @JsonKey(name: 'unit_price') this.unitPrice,
      this.amount,
      required this.material})
      : super._();
  factory _CartItem.fromJson(Map<String, dynamic> json) =>
      _$CartItemFromJson(json);

  @override
  final String id;
  @override
  @JsonKey(name: 'material_id')
  final String materialId;
  @override
  final double volume;
  @override
  @JsonKey(name: 'unit_price')
  final double? unitPrice;
  @override
  final double? amount;
  @override
  final MaterialItem material;

  /// Create a copy of CartItem
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  _$CartItemCopyWith<_CartItem> get copyWith =>
      __$CartItemCopyWithImpl<_CartItem>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$CartItemToJson(
      this,
    );
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _CartItem &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.materialId, materialId) ||
                other.materialId == materialId) &&
            (identical(other.volume, volume) || other.volume == volume) &&
            (identical(other.unitPrice, unitPrice) ||
                other.unitPrice == unitPrice) &&
            (identical(other.amount, amount) || other.amount == amount) &&
            (identical(other.material, material) ||
                other.material == material));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
      runtimeType, id, materialId, volume, unitPrice, amount, material);

  @override
  String toString() {
    return 'CartItem(id: $id, materialId: $materialId, volume: $volume, unitPrice: $unitPrice, amount: $amount, material: $material)';
  }
}

/// @nodoc
abstract mixin class _$CartItemCopyWith<$Res>
    implements $CartItemCopyWith<$Res> {
  factory _$CartItemCopyWith(_CartItem value, $Res Function(_CartItem) _then) =
      __$CartItemCopyWithImpl;
  @override
  @useResult
  $Res call(
      {String id,
      @JsonKey(name: 'material_id') String materialId,
      double volume,
      @JsonKey(name: 'unit_price') double? unitPrice,
      double? amount,
      MaterialItem material});

  @override
  $MaterialItemCopyWith<$Res> get material;
}

/// @nodoc
class __$CartItemCopyWithImpl<$Res> implements _$CartItemCopyWith<$Res> {
  __$CartItemCopyWithImpl(this._self, this._then);

  final _CartItem _self;
  final $Res Function(_CartItem) _then;

  /// Create a copy of CartItem
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $Res call({
    Object? id = null,
    Object? materialId = null,
    Object? volume = null,
    Object? unitPrice = freezed,
    Object? amount = freezed,
    Object? material = null,
  }) {
    return _then(_CartItem(
      id: null == id
          ? _self.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      materialId: null == materialId
          ? _self.materialId
          : materialId // ignore: cast_nullable_to_non_nullable
              as String,
      volume: null == volume
          ? _self.volume
          : volume // ignore: cast_nullable_to_non_nullable
              as double,
      unitPrice: freezed == unitPrice
          ? _self.unitPrice
          : unitPrice // ignore: cast_nullable_to_non_nullable
              as double?,
      amount: freezed == amount
          ? _self.amount
          : amount // ignore: cast_nullable_to_non_nullable
              as double?,
      material: null == material
          ? _self.material
          : material // ignore: cast_nullable_to_non_nullable
              as MaterialItem,
    ));
  }

  /// Create a copy of CartItem
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $MaterialItemCopyWith<$Res> get material {
    return $MaterialItemCopyWith<$Res>(_self.material, (value) {
      return _then(_self.copyWith(material: value));
    });
  }
}

// dart format on
