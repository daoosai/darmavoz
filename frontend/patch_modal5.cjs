const fs = require('fs');
let code = fs.readFileSync('src/LogistEditOrderModal.tsx', 'utf8');

code = code.replace(
  'newOrder.delivery_option_id === (order.delivery_option_id || "") &&',
  'newOrder.delivery_option_id === (order.vehicle_type_id || order.delivery_option_id || order.delivery_option?.id || "") &&'
);

fs.writeFileSync('src/LogistEditOrderModal.tsx', code);
