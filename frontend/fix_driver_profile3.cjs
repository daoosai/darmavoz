const fs = require('fs');
let code = fs.readFileSync('src/DriverProfileScreen.tsx', 'utf8');

code = code.replace('<NotificationToggle role="driver" />\n        ', '');

fs.writeFileSync('src/DriverProfileScreen.tsx', code);
