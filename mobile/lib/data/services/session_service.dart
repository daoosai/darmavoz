import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

class SessionService {
  static const _sessionKey = 'session_key';
  late final SharedPreferences _prefs;
  late final String sessionKey;

  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
    String? currentSessionKey = _prefs.getString(_sessionKey);
    if (currentSessionKey == null) {
      currentSessionKey = const Uuid().v4();
      await _prefs.setString(_sessionKey, currentSessionKey);
    }
    sessionKey = currentSessionKey;
  }
}
