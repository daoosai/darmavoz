const fs = require('fs');
let code = fs.readFileSync('src/LogistEditOrderModal.tsx', 'utf8');

code = code.replace(
  'interface DeliveryCalculationResult {',
  'interface DeliveryCalculationResult {\\n  delivery_lat?: number;\\n  delivery_lon?: number;'
);

code = code.replace(
  /delivery_lat: calculationResult\?\.delivery_lat \|\| newOrder\.delivery_lat \|\| order\.delivery_lat,/,
  'delivery_lat: calculationResult?.delivery_lat ?? newOrder.delivery_lat ?? order.delivery_lat,'
);
code = code.replace(
  /delivery_lon: calculationResult\?\.delivery_lon \|\| newOrder\.delivery_lon \|\| order\.delivery_lon,/,
  'delivery_lon: calculationResult?.delivery_lon ?? newOrder.delivery_lon ?? order.delivery_lon,'
);
code = code.replace(
  /estimated_total_amount: calculationResult\?\.estimated_total_amount \|\| order\.estimated_total_amount \|\| order\.total_amount/,
  'estimated_total_amount: calculationResult?.estimated_total_amount ?? order.estimated_total_amount ?? order.total_amount'
);

fs.writeFileSync('src/LogistEditOrderModal.tsx', code);
