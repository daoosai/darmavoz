# Security dependencies — 16.10.2026
Python 3.11: requirements.txt + resolved requirements.lock constraints;
Docker и test CI используют constraints. pip/setuptools обновлены в image.
FastAPI 0.143.2, Starlette 1.8.0, Pydantic 2.14.1, pydantic-settings 2.16.0,
python-multipart 0.0.32, python-dotenv 1.2.4; PyJWT[crypto] 2.15.1 вместо jose.
Legacy JWT совместимы при неизменных ключе/алгоритме/auth_version; exp обязателен.
pip check и pip-audit resolved set: pass / 0 advisories.

Capacitor core/android/ios/cli 8.4.3 pinned exact. npm overrides для assets
используют ту же CLI и sharp 0.35.5; исправлены transitive grpc/proxy-addr/
brace-expansion/source-map-js/fast-uri/uuid (CJS-compatible uuid 11.1.1 для xcode).
npm audit resolved lockfile: 0 advisories. Изменения dependency versions
не меняют app version/versionCode (3.1.7/387).
Серверные .env исключены из build context и inject-ятся только runtime.
Подробности доставки и проверок: ../2026-10-16-security-bugfix.md.

Финальная native-проверка 02b662c5: Android debug APK/signed AAB и macOS
Xcode 26.2 iOS Simulator sync/build прошли. Публикация в магазины не выполнялась.
