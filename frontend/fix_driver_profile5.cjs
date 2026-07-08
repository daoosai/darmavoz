const fs = require('fs');
let code = fs.readFileSync('src/DriverProfileScreen.tsx', 'utf8');

code = code.replace(
  '        <button\n          onClick={async () => {\n            try {\n              const currentToken = useAuthStore.getState().token;',
  '        <NotificationToggle role="driver" />\n        <button\n          onClick={async () => {\n            try {\n              const currentToken = useAuthStore.getState().token;'
);

fs.writeFileSync('src/DriverProfileScreen.tsx', code);
