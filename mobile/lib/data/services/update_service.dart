import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import 'api_service.dart';

class UpdateService {
  final ApiService _apiService;

  UpdateService(this._apiService);

  Future<void> checkForUpdates(BuildContext context) async {
    try {
      final versionInfo = await _apiService.getAppVersion();
      final latestVersion = versionInfo['latest_version'] as String;
      final downloadUrl = versionInfo['download_url'] as String;
      final forceUpdate = versionInfo['force_update'] as bool;

      final packageInfo = await PackageInfo.fromPlatform();
      final currentVersion = packageInfo.version;

      if (_isUpdateAvailable(currentVersion, latestVersion)) {
        if (context.mounted) {
          _showUpdateDialog(context, latestVersion, downloadUrl, forceUpdate);
        }
      }
    } catch (e) {
      debugPrint('Update check failed: $e');
    }
  }

  bool _isUpdateAvailable(String current, String latest) {
    List<int> currentParts = current.split('.').map((e) => int.tryParse(e) ?? 0).toList();
    List<int> latestParts = latest.split('.').map((e) => int.tryParse(e) ?? 0).toList();

    for (int i = 0; i < 3; i++) {
      int c = i < currentParts.length ? currentParts[i] : 0;
      int l = i < latestParts.length ? latestParts[i] : 0;
      if (l > c) return true;
      if (l < c) return false;
    }
    return false;
  }

  void _showUpdateDialog(
    BuildContext context,
    String latestVersion,
    String downloadUrl,
    bool forceUpdate,
  ) {
    showDialog(
      context: context,
      barrierDismissible: !forceUpdate,
      builder: (BuildContext dialogContext) {
        return AlertDialog(
          title: const Text('Доступно обновление'),
          content: Text('Вышла новая версия приложения: $latestVersion.\nПожалуйста, обновитесь для стабильной работы.'),
          actions: [
            if (!forceUpdate)
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: const Text('Позже'),
              ),
            ElevatedButton(
              onPressed: () async {
                final Uri url = Uri.parse(downloadUrl);
                if (await canLaunchUrl(url)) {
                  await launchUrl(url, mode: LaunchMode.externalApplication);
                } else {
                  debugPrint('Could not launch $url');
                }
              },
              child: const Text('Скачать'),
            ),
          ],
        );
      },
    );
  }
}
