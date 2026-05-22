import 'package:dio/dio.dart';
import 'package:darmavoz_mobile/data/models/category.dart' as model;
import '../../core/constants.dart';
import '../models/material_item.dart';
import '../models/cart_item.dart';

class ApiService {
  late final Dio _dio;

  String get baseUrl => Constants.baseUrl;

  ApiService() {
    _dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 10),
    ));
  }

  Future<List<model.Category>> getCategories() async {
    try {
      final response = await _dio.get('/api/v1/catalog/categories/');
      if (response.statusCode == 200) {
        final List<dynamic> data = response.data;
        return data.map((json) => model.Category.fromJson(json)).toList();
      } else {
        throw Exception('Не удалось загрузить категории');
      }
    } catch (e) {
      throw Exception('Ошибка загрузки категорий: $e');
    }
  }

  Future<List<MaterialItem>> getMaterials({String? categoryId}) async {
    try {
      final response = await _dio.get(
        '/api/v1/catalog/materials/',
        queryParameters: categoryId != null ? {'category_id': categoryId} : null,
      );
      if (response.statusCode == 200) {
        final List<dynamic> data = response.data;
        return data.map((json) => MaterialItem.fromJson(json)).toList();
      } else {
        throw Exception('Не удалось загрузить материалы');
      }
    } catch (e) {
      throw Exception('Ошибка загрузки материалов: $e');
    }
  }

  Future<MaterialItem> getMaterial(String id) async {
    try {
      final response = await _dio.get('/api/v1/catalog/materials/$id');
      if (response.statusCode == 200) {
        return MaterialItem.fromJson(response.data);
      } else {
        throw Exception('Не удалось загрузить материал');
      }
    } catch (e) {
      throw Exception('Ошибка загрузки материала: $e');
    }
  }

  Future<List<CartItem>> getCartItems(String sessionKey) async {
    try {
      final response = await _dio.get(
        '/api/v1/cart/',
        options: Options(headers: {'session_key': sessionKey}),
      );
      if (response.statusCode == 200) {
        final List<dynamic> data = response.data;
        return data.map((json) => CartItem.fromJson(json)).toList();
      } else {
        throw Exception('Не удалось загрузить корзину');
      }
    } catch (e) {
      throw Exception('Ошибка загрузки корзины: $e');
    }
  }

  Future<void> addCartItem(String sessionKey, String materialId, double volume) async {
    try {
      await _dio.post(
        '/api/v1/cart/items',
        data: {'material_id': materialId, 'volume': volume},
        options: Options(headers: {'session_key': sessionKey}),
      );
    } catch (e) {
      throw Exception('Ошибка добавления в корзину: $e');
    }
  }

  Future<void> updateCartItem(String sessionKey, String itemId, double volume) async {
    try {
      await _dio.patch(
        '/api/v1/cart/items/$itemId',
        data: {'volume': volume},
        options: Options(headers: {'session_key': sessionKey}),
      );
    } catch (e) {
      throw Exception('Ошибка обновления корзины: $e');
    }
  }

  Future<void> deleteCartItem(String sessionKey, String itemId) async {
    try {
      await _dio.delete(
        '/api/v1/cart/items/$itemId',
        options: Options(headers: {'session_key': sessionKey}),
      );
    } on DioException catch (e) {
      if (e.response?.statusCode == 404) {
        return; // Элемент уже удален на сервере
      }
      throw Exception('Ошибка удаления из корзины: $e');
    } catch (e) {
      throw Exception('Ошибка удаления из корзины: $e');
    }
  }

  Future<Map<String, dynamic>> getAppVersion() async {
    try {
      final response = await _dio.get('/api/v1/app-version');
      if (response.statusCode == 200) {
        return response.data as Map<String, dynamic>;
      } else {
        throw Exception('Не удалось проверить версию');
      }
    } catch (e) {
      throw Exception('Ошибка проверки версии: $e');
    }
  }
}
