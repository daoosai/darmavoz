const fs = require('fs');
let code = fs.readFileSync('src/LogistEditOrderModal.tsx', 'utf8');

code = code.replace(
  'const errorMessage = err.response?.data?.detail || err?.message || "Произошла ошибка при обновлении заказа";',
  'const errorMessage = err?.message || "Произошла ошибка при обновлении заказа";'
);

fs.writeFileSync('src/LogistEditOrderModal.tsx', code);
