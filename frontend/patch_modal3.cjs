const fs = require('fs');
let code = fs.readFileSync('src/LogistEditOrderModal.tsx', 'utf8');

code = code.replace(
  /const isFormIncomplete =[\s\S]*?!calculationResult;/,
  `const isFormIncomplete =
    !newOrder.client_phone ||
    !newOrder.material_id ||
    !newOrder.delivery_option_id ||
    !newOrder.delivery_address;`
);

code = code.replace(
  'const formattedDistance = calculationResult',
  `const calcMaterialCost = calculationResult ? Math.max(0, calculationResult.estimated_total_amount - calculationResult.delivery_cost) : 0;
  const formattedDistance = calculationResult`
);

code = code.replace(
  'Number(calculationResult.material_cost).toLocaleString("ru-RU")',
  'Number(calcMaterialCost).toLocaleString("ru-RU")'
);

code = code.replace(
  'disabled={isCreating || isCalculating || isFormIncomplete || !!calcError}',
  'disabled={isCreating || isCalculating || isFormIncomplete}'
);

fs.writeFileSync('src/LogistEditOrderModal.tsx', code);
