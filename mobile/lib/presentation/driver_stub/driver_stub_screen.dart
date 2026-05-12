import 'package:flutter/material.dart';

class DriverStubScreen extends StatelessWidget {
  const DriverStubScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Кабинет водителя'),
        centerTitle: true,
      ),
      body: const Center(
        child: Text(
          'Интерфейс водителя — в разработке',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w500,
          ),
          textAlign: TextAlign.center,
        ),
      ),
    );
  }
}
