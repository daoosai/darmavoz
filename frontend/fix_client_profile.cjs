const fs = require('fs');
let code = fs.readFileSync('src/ClientProfileScreen.tsx', 'utf8');

if (!code.includes('NotificationToggle')) {
  code = code.replace(
    /import \{[\s\S]*?\} from "lucide-react";/,
    match => match + "\nimport { NotificationToggle } from \"./components/shared/NotificationToggle\";"
  );
  
  code = code.replace(
    /\{\/\* Useful Actions \*\/\}\s*<div className="px-4 mt-6 flex flex-col gap-3">[\s\S]*?Позвонить диспетчеру\s*<\/span>\s*<\/button>\s*<\/div>/,
    match => match + "\n      <div className=\"px-4\">\n        <NotificationToggle role=\"client\" />\n      </div>"
  );
}

fs.writeFileSync('src/ClientProfileScreen.tsx', code);
