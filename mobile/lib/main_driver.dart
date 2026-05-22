import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'router/driver_router.dart';
import 'theme/app_theme.dart';
import 'presentation/providers/cart_provider.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const DarmavozDriverApp());
}

class DarmavozDriverApp extends StatelessWidget {
  const DarmavozDriverApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => CartProvider()),
      ],
      child: MaterialApp.router(
        title: 'Дармавоз Водитель',
        theme: AppTheme.driverTheme,
        routerConfig: driverRouter,
        debugShowCheckedModeBanner: false,
      ),
    );
  }
}
