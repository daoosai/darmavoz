const fs = require('fs');
let code = fs.readFileSync('src/DriverProfileScreen.tsx', 'utf8');

// 1. Remove the wrongly placed NotificationToggle
code = code.replace(/<NotificationToggle role="driver" \/>\n\s*/, '');

// 2. Insert it before the "Выйти из аккаунта" button properly
// We know it's near the end.
code = code.replace(
  /(<button[\s\S]*?Выйти из аккаунта\s*<\/button>\s*\{\/\* Распорка для TabBar \*\/\})/,
  match => "<NotificationToggle role=\"driver\" />\n        " + match
);

fs.writeFileSync('src/DriverProfileScreen.tsx', code);
