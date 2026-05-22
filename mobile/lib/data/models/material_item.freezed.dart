// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'material_item.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$MaterialItem {
  String get id;
  @JsonKey(name: 'category_id')
  String get categoryId;
  String get name;
  String? get description;
  double? get price;
  String get unit;
  @JsonKey(name: 'min_volume')
  double get minVolume;
  @JsonKey(name: 'image_url')
  String? get imageUrl;
  @JsonKey(name: 'is_active')
  bool get isActive;

  /// Create a copy of MaterialItem
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $MaterialItemCopyWith<MaterialItem> get copyWith =>
      _$MaterialItemCopyWithImpl<MaterialItem>(
          this as MaterialItem, _$identity);

  /// Serializes this MaterialItem to a JSON map.
  Map<String, dynamic> toJson();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is MaterialItem &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.categoryId, categoryId) ||
                other.categoryId == categoryId) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.description, description) ||
                other.description == description) &&
            (identical(other.price, price) || other.price == price) &&
            (identical(other.unit, unit) || other.unit == unit) &&
            (identical(other.minVolume, minVolume) ||
                other.minVolume == minVolume) &&
            (identical(other.imageUrl, imageUrl) ||
                other.imageUrl == imageUrl) &&
            (identical(other.isActive, isActive) ||
                other.isActive == isActive));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, id, categoryId, name,
      description, price, unit, minVolume, imageUrl, isActive);

  @override
  String toString() {
    return 'MaterialItem(id: $id, categoryId: $categoryId, name: $name, description: $description, price: $price, unit: $unit, minVolume: $minVolume, imageUrl: $imageUrl, isActive: $isActive)';
  }
}

/// @nodoc
abstract mixin class $MaterialItemCopyWith<$Res> {
  factory $MaterialItemCopyWith(
          MaterialItem value, $Res Function(MaterialItem) _then) =
      _$MaterialItemCopyWithImpl;
  @useResult
  $Res call(
      {String id,
      @JsonKey(name: 'category_id') String categoryId,
      String name,
      String? description,
      double? price,
      String unit,
      @JsonKey(name: 'min_volume') double minVolume,
      @JsonKey(name: 'image_url') String? imageUrl,
      @JsonKey(name: 'is_active') bool isActive});
}

/// @nodoc
class _$MaterialItemCopyWithImpl<$Res> implements $MaterialItemCopyWith<$Res> {
  _$MaterialItemCopyWithImpl(this._self, this._then);

  final MaterialItem _self;
  final $Res Function(MaterialItem) _then;

  /// Create a copy of MaterialItem
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? categoryId = null,
    Object? name = null,
    Object? description = freezed,
    Object? price = freezed,
    Object? unit = null,
    Object? minVolume = null,
    Object? imageUrl = freezed,
    Object? isActive = null,
  }) {
    return _then(_self.copyWith(
      id: null == id
          ? _self.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      categoryId: null == categoryId
          ? _self.categoryId
          : categoryId // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _self.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      description: freezed == description
          ? _self.description
          : description // ignore: cast_nullable_to_non_nullable
              as String?,
      price: freezed == price
          ? _self.price
          : price // ignore: cast_nullable_to_non_nullable
              as double?,
      unit: null == unit
          ? _self.unit
          : unit // ignore: cast_nullable_to_non_nullable
              as String,
      minVolume: null == minVolume
          ? _self.minVolume
          : minVolume // ignore: cast_nullable_to_non_nullable
              as double,
      imageUrl: freezed == imageUrl
          ? _self.imageUrl
          : imageUrl // ignore: cast_nullable_to_non_nullable
              as String?,
      isActive: null == isActive
          ? _self.isActive
          : isActive // ignore: cast_nullable_to_non_nullable
              as bool,
    ));
  }
}

/// Adds pattern-matching-related methods to [MaterialItem].
extension MaterialItemPatterns on MaterialItem {
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
    TResult Function(_MaterialItem value)? $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _MaterialItem() when $default != null:
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
    TResult Function(_MaterialItem value) $default,
  ) {
    final _that = this;
    switch (_that) {
      case _MaterialItem():
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
    TResult? Function(_MaterialItem value)? $default,
  ) {
    final _that = this;
    switch (_that) {
      case _MaterialItem() when $default != null:
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
            @JsonKey(name: 'category_id') String categoryId,
            String name,
            String? description,
            double? price,
            String unit,
            @JsonKey(name: 'min_volume') double minVolume,
            @JsonKey(name: 'image_url') String? imageUrl,
            @JsonKey(name: 'is_active') bool isActive)?
        $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _MaterialItem() when $default != null:
        return $default(
            _that.id,
            _that.categoryId,
            _that.name,
            _that.description,
            _that.price,
            _that.unit,
            _that.minVolume,
            _that.imageUrl,
            _that.isActive);
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
            @JsonKey(name: 'category_id') String categoryId,
            String name,
            String? description,
            double? price,
            String unit,
            @JsonKey(name: 'min_volume') double minVolume,
            @JsonKey(name: 'image_url') String? imageUrl,
            @JsonKey(name: 'is_active') bool isActive)
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _MaterialItem():
        return $default(
            _that.id,
            _that.categoryId,
            _that.name,
            _that.description,
            _that.price,
            _that.unit,
            _that.minVolume,
            _that.imageUrl,
            _that.isActive);
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
            @JsonKey(name: 'category_id') String categoryId,
            String name,
            String? description,
            double? price,
            String unit,
            @JsonKey(name: 'min_volume') double minVolume,
            @JsonKey(name: 'image_url') String? imageUrl,
            @JsonKey(name: 'is_active') bool isActive)?
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _MaterialItem() when $default != null:
        return $default(
            _that.id,
            _that.categoryId,
            _that.name,
            _that.description,
            _that.price,
            _that.unit,
            _that.minVolume,
            _that.imageUrl,
            _that.isActive);
      case _:
        return null;
    }
  }
}

/// @nodoc
@JsonSerializable()
class _MaterialItem extends MaterialItem {
  const _MaterialItem(
      {required this.id,
      @JsonKey(name: 'category_id') required this.categoryId,
      required this.name,
      this.description,
      this.price,
      required this.unit,
      @JsonKey(name: 'min_volume') required this.minVolume,
      @JsonKey(name: 'image_url') this.imageUrl,
      @JsonKey(name: 'is_active') required this.isActive})
      : super._();
  factory _MaterialItem.fromJson(Map<String, dynamic> json) =>
      _$MaterialItemFromJson(json);

  @override
  final String id;
  @override
  @JsonKey(name: 'category_id')
  final String categoryId;
  @override
  final String name;
  @override
  final String? description;
  @override
  final double? price;
  @override
  final String unit;
  @override
  @JsonKey(name: 'min_volume')
  final double minVolume;
  @override
  @JsonKey(name: 'image_url')
  final String? imageUrl;
  @override
  @JsonKey(name: 'is_active')
  final bool isActive;

  /// Create a copy of MaterialItem
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  _$MaterialItemCopyWith<_MaterialItem> get copyWith =>
      __$MaterialItemCopyWithImpl<_MaterialItem>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$MaterialItemToJson(
      this,
    );
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _MaterialItem &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.categoryId, categoryId) ||
                other.categoryId == categoryId) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.description, description) ||
                other.description == description) &&
            (identical(other.price, price) || other.price == price) &&
            (identical(other.unit, unit) || other.unit == unit) &&
            (identical(other.minVolume, minVolume) ||
                other.minVolume == minVolume) &&
            (identical(other.imageUrl, imageUrl) ||
                other.imageUrl == imageUrl) &&
            (identical(other.isActive, isActive) ||
                other.isActive == isActive));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, id, categoryId, name,
      description, price, unit, minVolume, imageUrl, isActive);

  @override
  String toString() {
    return 'MaterialItem(id: $id, categoryId: $categoryId, name: $name, description: $description, price: $price, unit: $unit, minVolume: $minVolume, imageUrl: $imageUrl, isActive: $isActive)';
  }
}

/// @nodoc
abstract mixin class _$MaterialItemCopyWith<$Res>
    implements $MaterialItemCopyWith<$Res> {
  factory _$MaterialItemCopyWith(
          _MaterialItem value, $Res Function(_MaterialItem) _then) =
      __$MaterialItemCopyWithImpl;
  @override
  @useResult
  $Res call(
      {String id,
      @JsonKey(name: 'category_id') String categoryId,
      String name,
      String? description,
      double? price,
      String unit,
      @JsonKey(name: 'min_volume') double minVolume,
      @JsonKey(name: 'image_url') String? imageUrl,
      @JsonKey(name: 'is_active') bool isActive});
}

/// @nodoc
class __$MaterialItemCopyWithImpl<$Res>
    implements _$MaterialItemCopyWith<$Res> {
  __$MaterialItemCopyWithImpl(this._self, this._then);

  final _MaterialItem _self;
  final $Res Function(_MaterialItem) _then;

  /// Create a copy of MaterialItem
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $Res call({
    Object? id = null,
    Object? categoryId = null,
    Object? name = null,
    Object? description = freezed,
    Object? price = freezed,
    Object? unit = null,
    Object? minVolume = null,
    Object? imageUrl = freezed,
    Object? isActive = null,
  }) {
    return _then(_MaterialItem(
      id: null == id
          ? _self.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      categoryId: null == categoryId
          ? _self.categoryId
          : categoryId // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _self.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      description: freezed == description
          ? _self.description
          : description // ignore: cast_nullable_to_non_nullable
              as String?,
      price: freezed == price
          ? _self.price
          : price // ignore: cast_nullable_to_non_nullable
              as double?,
      unit: null == unit
          ? _self.unit
          : unit // ignore: cast_nullable_to_non_nullable
              as String,
      minVolume: null == minVolume
          ? _self.minVolume
          : minVolume // ignore: cast_nullable_to_non_nullable
              as double,
      imageUrl: freezed == imageUrl
          ? _self.imageUrl
          : imageUrl // ignore: cast_nullable_to_non_nullable
              as String?,
      isActive: null == isActive
          ? _self.isActive
          : isActive // ignore: cast_nullable_to_non_nullable
              as bool,
    ));
  }
}

// dart format on
