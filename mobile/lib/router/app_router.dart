import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../presentation/core/main_scaffold.dart';
import '../presentation/home/home_screen.dart';
import '../presentation/orders/orders_screen.dart';
import '../presentation/cart/cart_screen.dart';
import '../presentation/promos/promos_screen.dart';
import '../presentation/profile/profile_screen.dart';
import '../presentation/role_selection/role_selection_screen.dart';
import '../presentation/driver_stub/driver_stub_screen.dart';

final _rootNavigatorKey = GlobalKey<NavigatorState>();

final _homeTabKey = GlobalKey<NavigatorState>(debugLabel: 'homeTab');
final _ordersTabKey = GlobalKey<NavigatorState>(debugLabel: 'ordersTab');
final _cartTabKey = GlobalKey<NavigatorState>(debugLabel: 'cartTab');
final _promosTabKey = GlobalKey<NavigatorState>(debugLabel: 'promosTab');
final _profileTabKey = GlobalKey<NavigatorState>(debugLabel: 'profileTab');

final GoRouter appRouter = GoRouter(
  navigatorKey: _rootNavigatorKey,
  initialLocation: '/role-selection',
  routes: [
    GoRoute(
      path: '/role-selection',
      builder: (context, state) => const RoleSelectionScreen(),
    ),
    GoRoute(
      path: '/driver-stub',
      builder: (context, state) => const DriverStubScreen(),
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
  ],
);
