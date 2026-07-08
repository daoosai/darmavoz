const fs = require('fs');
let code = fs.readFileSync('src/AdminProfileScreen.tsx', 'utf8');

if (!code.includes('NotificationToggle')) {
  code = code.replace(
    /import \{[\s\S]*?\} from "lucide-react";/,
    match => match + "\nimport { NotificationToggle } from \"./components/shared/NotificationToggle\";"
  );
  
  code = code.replace(
    /<button\s+onClick=\{onLogout\}\s+className="flex items-center justify-center gap-2 w-full bg-red-50 text-red-600/,
    match => "<NotificationToggle role=\"admin\" />\n      " + match
  );
}

fs.writeFileSync('src/AdminProfileScreen.tsx', code);
