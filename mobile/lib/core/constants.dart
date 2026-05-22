class Constants {
  static const bool isProduction = true;

  static String get baseUrl {
    if (isProduction) {
      return 'https://darmavoz.ru';
    } else {
      return 'http://192.168.1.100:8000';
    }
  }
}
