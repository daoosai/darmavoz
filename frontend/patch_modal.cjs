const fs = require('fs');
let code = fs.readFileSync('src/LogistEditOrderModal.tsx', 'utf8');

// Replace useEffect for mapping
code = code.replace(
  /useEffect\(\(\) => \{\n    if \(isOpen && order\) \{[\s\S]*?\} else if \(\!isOpen\) \{/,
  `useEffect(() => {
    if (isOpen && order) {
      setNewOrder({
        client_name: order.client_name || order.client?.name || "",
        client_phone: order.client_phone || order.client?.phone || "",
        material_id: order.material_id || order.items?.[0]?.material_id || order.items?.[0]?.material?.id || "",
        delivery_option_id: order.vehicle_type_id || order.delivery_option_id || order.delivery_option?.id || "",
        delivery_address: order.delivery_address || order.address || "",
        delivery_lat: order.delivery_lat || null,
        delivery_lon: order.delivery_lon || null,
        notes: order.notes || "",
      });
      if (order.estimated_total_amount || order.total_amount) {
        setCalculationResult({
          quarry_id: order.quarry_id || "",
          quarry_name: order.quarry_name || order.quarry?.name || (order.quarry_id ? "Выбранный карьер" : "Карьер"),
          mileage_km: order.mileage_km || 0,
          material_cost: order.material_cost || (order.total_amount - (order.delivery_cost || 0)) || 0,
          delivery_cost: order.delivery_cost || 0,
          estimated_total_amount: order.estimated_total_amount || order.total_amount || 0
        });
      }
    } else if (!isOpen) {`
);

// Replace handleUpdateOrder payload and URL
code = code.replace(
  /const payload = \{[\s\S]*?auto_dispatch: true,\n      \};\n\n      const res = await fetch\(\`\$\{baseURL\}\/logist\/orders\/\$\{order.id\}\`, \{\n        method: "PATCH",/,
  `const payload = {
        client_name: normalizedClientName,
        client_phone: cleanPhone,
        notes: newOrder.notes,
        delivery_address: newOrder.delivery_address,
        delivery_lat: calculationResult?.delivery_lat || newOrder.delivery_lat || order.delivery_lat,
        delivery_lon: calculationResult?.delivery_lon || newOrder.delivery_lon || order.delivery_lon,
        material_id: newOrder.material_id,
        delivery_option_id: newOrder.delivery_option_id,
        quarry_id: calculationResult?.quarry_id || order.quarry_id,
        estimated_total_amount: calculationResult?.estimated_total_amount || order.estimated_total_amount || order.total_amount
      };

      const res = await fetch(\`\${baseURL}/admin/orders/\${order.id}\`, {
        method: "PATCH",`
);

fs.writeFileSync('src/LogistEditOrderModal.tsx', code);
