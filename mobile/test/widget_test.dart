import 'package:flutter_test/flutter_test.dart';
import 'package:darmavoz_mobile/main_client.dart';
import 'package:darmavoz_mobile/main_driver.dart';
import 'package:darmavoz_mobile/presentation/role_selection/role_selection_screen.dart';
import 'package:darmavoz_mobile/presentation/driver_home/driver_home_screen.dart';

void main() {
  testWidgets('Smoke test: Client App starts successfully', (WidgetTester tester) async {
    await tester.pumpWidget(const DarmavozApp());
    await tester.pumpAndSettle();

    expect(find.byType(RoleSelectionScreen), findsOneWidget);
  });

  testWidgets('Smoke test: Driver App starts successfully', (WidgetTester tester) async {
    await tester.pumpWidget(const DarmavozDriverApp());
    await tester.pumpAndSettle();

    expect(find.byType(DriverHomeScreen), findsOneWidget);
  });
}
