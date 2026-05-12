import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import '../models/product.dart';

class ApiService {
  late final Dio _dio;
  
  String get baseUrl {
    if (kReleaseMode) {
      return 'https://darmavoz.ru';
    } else {
      if (kIsWeb) {
        return 'http://localhost:8000';
      } else {
        return 'http://10.0.2.2:8000';
      }
    }
  }

  ApiService() {
    _dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 10),
    ));
  }

  Future<List<Product>> getProducts() async {
    try {
      final response = await _dio.get('/api/v1/products');
      if (response.statusCode == 200) {
        final List<dynamic> data = response.data;
        return data.map((json) => Product.fromJson(json)).toList();
      } else {
        throw Exception('Не удалось загрузить товары');
      }
    } catch (e) {
      throw Exception('Ошибка загрузки: $e');
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
