const fs = require('fs');
let code = fs.readFileSync('src/DriverProfileScreen.tsx', 'utf8');

code = code.replace(
  '        <button\n          onClick={async () => {\n            try {\n              setIsLoading(true);\n              const currentToken = useAuthStore.getState().token;\n\n              // Remove FCM token on logout',
  '        <NotificationToggle role="driver" />\n        <button\n          onClick={async () => {\n            try {\n              setIsLoading(true);\n              const currentToken = useAuthStore.getState().token;\n\n              // Remove FCM token on logout'
);

fs.writeFileSync('src/DriverProfileScreen.tsx', code);
