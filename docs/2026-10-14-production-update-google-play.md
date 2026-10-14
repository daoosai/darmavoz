# Production: ссылка обновления только на Google Play — 14.10.2026

Пользователь поручил убрать тестовый APK из production API обновлений и направлять обновление только в Google Play. До изменения GET /api/v1/system/version возвращал /static/darmavoz-test.apk (404). В production .env отсутствует APK_DOWNLOAD_URL, поэтому применялся ошибочный fallback из app/core/config.py.

В main изменён только fallback APK_DOWNLOAD_URL: https://play.google.com/store/apps/details?id=ru.darmavoz.app. Оба API версии используют settings.APK_DOWNLOAD_URL. Production UpdateBanner уже принудительно открывает ту же Google Play страницу; frontend не изменён. Серверные .env, версии/build и test backend не меняются. Полного merge develop/main нет. Для пользователей этой серверной правки новая версия APK не нужна.

Доставка и публичные проверки фиксируются после развёртывания.
