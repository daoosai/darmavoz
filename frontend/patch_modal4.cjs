const fs = require('fs');
let code = fs.readFileSync('src/LogistEditOrderModal.tsx', 'utf8');

code = code.replace(
  /if \(\n      digitsOnly\.length < 11 \|\|\n      \!newOrder\.material_id \|\|\n      \!newOrder\.delivery_option_id \|\|\n      \!newOrder\.delivery_address \|\|\n      newOrder\.delivery_lat == null \|\|\n      newOrder\.delivery_lon == null \|\|\n      \!calculationResult\n    \) \{\n      toast\.error\("Заполните обязательные поля и дождитесь расчета доставки"\);\n      return;\n    \}/,
  `if (
      digitsOnly.length < 11 ||
      !newOrder.material_id ||
      !newOrder.delivery_option_id ||
      !newOrder.delivery_address
    ) {
      toast.error("Заполните обязательные поля");
      return;
    }`
);

fs.writeFileSync('src/LogistEditOrderModal.tsx', code);
