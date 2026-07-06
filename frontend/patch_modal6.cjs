const fs = require('fs');
let code = fs.readFileSync('src/LogistEditOrderModal.tsx', 'utf8');

code = code.replace(
  'newOrder.material_id === (order.items?.[0]?.material_id || order.items?.[0]?.material?.id || "")',
  'newOrder.material_id === (order.material_id || order.items?.[0]?.material_id || order.items?.[0]?.material?.id || "")'
);

fs.writeFileSync('src/LogistEditOrderModal.tsx', code);
