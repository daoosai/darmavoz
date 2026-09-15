# Правила обновления версии приложения

## ПРАВИЛА ОБНОВЛЕНИЯ ВЕРСИИ ПРИЛОЖЕНИЯ

1. Пользователь (Tech Lead) САМ вручную меняет версию в серверных файлах `.env` в `/opt/darmavoz_deploy` и `/opt/darmavoz_test_deploy`. Кодексу туда лезть ЗАПРЕЩЕНО.
2. Задача Кодекса при релизах и хотфиксах — обновить версию в самом коде:
   - в `frontend/package.json` (поле `version`);
   - в мобильной сборке Android: `frontend/android/app/build.gradle` (обновить `versionName` и обязательно инкрементировать `versionCode` на `+1`, чтобы RuStore и Google Play приняли сборку);
   - в мобильной сборке iOS, если она инициализирована: `frontend/ios/App/App/Info.plist` (`CFBundleShortVersionString` и `CFBundleVersion`).
