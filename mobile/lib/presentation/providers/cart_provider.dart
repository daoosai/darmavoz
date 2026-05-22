import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
import '../../data/models/cart_item.dart';
import '../../data/models/material_item.dart';
import '../../data/services/api_service.dart';

class CartProvider extends ChangeNotifier {
  final ApiService _apiService = ApiService();
  
  List<CartItem> _cartItems = [];
  bool _isLoading = false;
  String? _error;

  List<CartItem> get cartItems => _cartItems;
  bool get isLoading => _isLoading;
  String? get error => _error;

  double get totalAmount => _cartItems.fold<double>(0, (sum, item) => sum + (item.amount ?? 0));

  Future<void> fetchCart(String sessionKey) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      _cartItems = await _apiService.getCartItems(sessionKey);
    } on DioException catch (e) {
      _error = 'Ошибка загрузки корзины: ${e.message}';
    } catch (e) {
      _error = 'Неизвестная ошибка: $e';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> addToCart(String sessionKey, MaterialItem material, double volume) async {
    try {
      await _apiService.addCartItem(sessionKey, material.id, volume);
      await fetchCart(sessionKey);
    } on DioException catch (e) {
      _error = 'Ошибка добавления в корзину: ${e.message}';
      notifyListeners();
      rethrow;
    } catch (e) {
      _error = 'Ошибка: $e';
      notifyListeners();
      rethrow;
    }
  }

  Future<void> updateVolume(String sessionKey, String cartItemId, double newVolume) async {
    try {
      await _apiService.updateCartItem(sessionKey, cartItemId, newVolume);
      await fetchCart(sessionKey);
    } on DioException catch (e) {
      _error = 'Ошибка обновления корзины: ${e.message}';
      notifyListeners();
      rethrow;
    } catch (e) {
      _error = 'Ошибка: $e';
      notifyListeners();
      rethrow;
    }
  }

  Future<void> removeFromCart(String sessionKey, String cartItemId) async {
    try {
      await _apiService.deleteCartItem(sessionKey, cartItemId);
      await fetchCart(sessionKey);
    } on DioException catch (e) {
      if (e.response?.statusCode != 404) {
        _error = 'Ошибка удаления: ${e.message}';
        notifyListeners();
        rethrow;
      } else {
        await fetchCart(sessionKey);
      }
    } catch (e) {
      _error = 'Ошибка: $e';
      notifyListeners();
      rethrow;
    }
  }
}
