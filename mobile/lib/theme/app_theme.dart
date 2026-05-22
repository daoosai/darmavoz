import 'package:flutter/material.dart';

class AppTheme {
  static const Color primaryDeepBlue = Color(0xFF0D47A1); // Глубокий синий
  static const Color backgroundLightGray = Color(0xFFF5F5F5); // Светло-серый фон
  static const Color driverPrimaryGreen = Color(0xFF2E7D32); // Темно-зеленый для водителей

  static ThemeData get lightTheme {
    return ThemeData(
      primaryColor: primaryDeepBlue,
      scaffoldBackgroundColor: backgroundLightGray,
      colorScheme: ColorScheme.fromSeed(
        seedColor: primaryDeepBlue,
        primary: primaryDeepBlue,
        background: backgroundLightGray,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: primaryDeepBlue,
        foregroundColor: Colors.white,
        centerTitle: true,
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        selectedItemColor: primaryDeepBlue,
        unselectedItemColor: Colors.grey,
        backgroundColor: Colors.white,
        type: BottomNavigationBarType.fixed,
      ),
    );
  }

  static ThemeData get driverTheme {
    return ThemeData(
      primaryColor: driverPrimaryGreen,
      scaffoldBackgroundColor: backgroundLightGray,
      colorScheme: ColorScheme.fromSeed(
        seedColor: driverPrimaryGreen,
        primary: driverPrimaryGreen,
        background: backgroundLightGray,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: driverPrimaryGreen,
        foregroundColor: Colors.white,
        centerTitle: true,
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        selectedItemColor: driverPrimaryGreen,
        unselectedItemColor: Colors.grey,
        backgroundColor: Colors.white,
        type: BottomNavigationBarType.fixed,
      ),
    );
  }
}
