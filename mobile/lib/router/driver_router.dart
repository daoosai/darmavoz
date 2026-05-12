import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../presentation/core/driver_main_scaffold.dart';
import '../presentation/driver_home/driver_home_screen.dart';
import '../presentation/driver_orders/driver_orders_screen.dart';
import '../presentation/driver_profile/driver_profile_screen.dart';

final _rootNavigatorKey = GlobalKey<NavigatorState>();

final _driverHomeTabKey = GlobalKey<NavigatorState>(debugLabel: 'driverHomeTab');
final _driverOrdersTabKey = GlobalKey<NavigatorState>(debugLabel: 'driverOrdersTab');
final _driverProfileTabKey = GlobalKey<NavigatorState>(debugLabel: 'driverProfileTab');

final GoRouter driverRouter = GoRouter(
  navigatorKey: _rootNavigatorKey,
  initialLocation: '/driver/home',
  routes: [
    StatefulShellRoute.indexedStack(
      builder: (context, state, navigationShell) {
        return DriverMainScaffold(navigationShell: navigationShell);
      },
      branches: [
        StatefulShellBranch(
          navigatorKey: _driverHomeTabKey,
          routes: [
            GoRoute(
              path: '/driver/home',
              builder: (context, state) => const DriverHomeScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          navigatorKey: _driverOrdersTabKey,
          routes: [
            GoRoute(
              path: '/driver/orders',
              builder: (context, state) => const DriverOrdersScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          navigatorKey: _driverProfileTabKey,
          routes: [
            GoRoute(
              path: '/driver/profile',
              builder: (context, state) => const DriverProfileScreen(),
            ),
          ],
        ),
      ],
    ),
  ],
);
