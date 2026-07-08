const fs = require('fs');
let code = fs.readFileSync('src/DriverProfileScreen.tsx', 'utf8');

if (!code.includes('NotificationToggle')) {
  code = code.replace(
    /import \{[\s\S]*?\} from "lucide-react";/,
    match => match + "\nimport { NotificationToggle } from \"./components/shared/NotificationToggle\";"
  );
  
  code = code.replace(
    /<button[\s\S]*?onClick=\{\(\) => \{[\s\S]*?logout\(\);\s*onLogout\(\);\s*\}\}[\s\S]*?Выйти из аккаунта\s*<\/button>/,
    match => "<NotificationToggle role=\"driver\" />\n        " + match
  );
}

fs.writeFileSync('src/DriverProfileScreen.tsx', code);
