const fs = require('fs');
let code = fs.readFileSync('src/LogistDashboardScreen.tsx', 'utf8');

code = code.replace(
  'const handleDeleteOrder = async (orderId: string) => {\\n    try {',
  'const handleDeleteOrder = async (orderId: string) => {\\n    if (!window.confirm("Вы уверены, что хотите перенести заказ в архив?")) {\\n      return;\\n    }\\n    try {'
);

fs.writeFileSync('src/LogistDashboardScreen.tsx', code);
