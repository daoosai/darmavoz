import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:darmavoz_mobile/router/app_router.dart';
import 'presentation/providers/cart_provider.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => CartProvider()),
      ],
      child: MaterialApp.router(
        title: 'Дармавоз',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          primaryColor: const Color(0xFF3AA9E1),
          scaffoldBackgroundColor: Colors.grey.shade50,
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF3AA9E1),
            primary: const Color(0xFF3AA9E1),
          ),
          appBarTheme: const AppBarTheme(
            backgroundColor: Colors.white,
            foregroundColor: Colors.black,
            elevation: 0,
          ),
          useMaterial3: true,
        ),
        routerConfig: appRouter,
      ),
    );
  }
}
