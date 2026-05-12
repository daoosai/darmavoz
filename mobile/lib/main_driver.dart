import 'package:flutter/material.dart';

import 'router/driver_router.dart';
import 'theme/app_theme.dart';

void main() {
  runApp(const DarmavozDriverApp());
}

class DarmavozDriverApp extends StatelessWidget {
  const DarmavozDriverApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Дармавоз Водитель',
      theme: AppTheme.driverTheme,
      routerConfig: driverRouter,
      debugShowCheckedModeBanner: false,
    );
  }
}
