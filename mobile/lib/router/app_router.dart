import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../presentation/core/main_scaffold.dart';
import '../presentation/core/driver_main_scaffold.dart';
import '../presentation/home/home_screen.dart';
import '../presentation/orders/orders_screen.dart';
import '../presentation/cart/cart_screen.dart';
import '../presentation/promos/promos_screen.dart';
import '../presentation/profile/profile_screen.dart';
import '../presentation/role_selection/role_selection_screen.dart';
import '../presentation/driver_home/driver_home_screen.dart';
import '../presentation/driver_orders/driver_orders_screen.dart';
import '../presentation/driver_profile/driver_profile_screen.dart';

final _rootNavigatorKey = GlobalKey<NavigatorState>();

final _homeTabKey = GlobalKey<NavigatorState>(debugLabel: 'homeTab');
final _ordersTabKey = GlobalKey<NavigatorState>(debugLabel: 'ordersTab');
final _cartTabKey = GlobalKey<NavigatorState>(debugLabel: 'cartTab');
final _promosTabKey = GlobalKey<NavigatorState>(debugLabel: 'promosTab');
final _profileTabKey = GlobalKey<NavigatorState>(debugLabel: 'profileTab');

final _driverHomeTabKey = GlobalKey<NavigatorState>(debugLabel: 'driverHomeTab');
final _driverOrdersTabKey = GlobalKey<NavigatorState>(debugLabel: 'driverOrdersTab');
final _driverProfileTabKey = GlobalKey<NavigatorState>(debugLabel: 'driverProfileTab');

final GoRouter appRouter = GoRouter(
  navigatorKey: _rootNavigatorKey,
  initialLocation: '/role-selection',
  routes: [
    GoRoute(
      path: '/role-selection',
      builder: (context, state) => const RoleSelectionScreen(),
    ),
    StatefulShellRoute.indexedStack(
      builder: (context, state, navigationShell) {
        return MainScaffold(navigationShell: navigationShell);
      },
      branches: [
        StatefulShellBranch(
          navigatorKey: _homeTabKey,
          routes: [
            GoRoute(
              path: '/home',
              builder: (context, state) => const HomeScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          navigatorKey: _ordersTabKey,
          routes: [
            GoRoute(
              path: '/orders',
              builder: (context, state) => const OrdersScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          navigatorKey: _cartTabKey,
          routes: [
            GoRoute(
              path: '/cart',
              builder: (context, state) => const CartScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          navigatorKey: _promosTabKey,
          routes: [
            GoRoute(
              path: '/promos',
              builder: (context, state) => const PromosScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          navigatorKey: _profileTabKey,
          routes: [
            GoRoute(
              path: '/profile',
              builder: (context, state) => const ProfileScreen(),
            ),
          ],
        ),
      ],
    ),
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
