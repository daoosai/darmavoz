const fs = require('fs');
let code = fs.readFileSync('src/LogistDashboardScreen.tsx', 'utf8');

// 1. Update useState for orderStatusTab
code = code.replace(
  /const \[orderStatusTab, setOrderStatusTab\] = useState<"active" \| "archived">\(.*?active.*?\);/,
  'const [orderStatusTab, setOrderStatusTab] = useState<"active" | "completed" | "archived">("active");'
);

// 2. Add filtering logic before return statement
const filterLogic = `
  const activeOrders = orders.filter(o => 
    o.status?.toLowerCase() !== 'completed' && 
    o.status?.toLowerCase() !== 'canceled' && 
    o.status?.toLowerCase() !== 'cancelled' &&
    o.status?.toLowerCase() !== 'driver_cancel'
  );

  const completedOrders = orders.filter(o => 
    o.status?.toLowerCase() === 'completed'
  );

  const displayedOrders = orderStatusTab === 'active' 
    ? activeOrders 
    : orderStatusTab === 'completed' 
      ? completedOrders 
      : orders;
`;

code = code.replace(
  'return (',
  `${filterLogic}\n\n  return (`
);

// 3. Update tabs rendering
code = code.replace(
  /<div className="flex bg-slate-100 p-1 rounded-lg self-start">[\s\S]*?<\/div>/,
  `<div className="flex bg-slate-100 p-1 rounded-lg self-start grid grid-cols-3 gap-1 w-full max-w-md">
                    <button
                      onClick={() => setOrderStatusTab("active")}
                      className={\`px-3 py-1.5 text-sm font-bold rounded-md transition-colors \${
                        orderStatusTab === "active"
                          ? "bg-white text-slate-800 shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                      }\`}
                    >
                      Активные
                    </button>
                    <button
                      onClick={() => setOrderStatusTab("completed")}
                      className={\`px-3 py-1.5 text-sm font-bold rounded-md transition-colors \${
                        orderStatusTab === "completed"
                          ? "bg-white text-slate-800 shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                      }\`}
                    >
                      Завершенные
                    </button>
                    <button
                      onClick={() => setOrderStatusTab("archived")}
                      className={\`px-3 py-1.5 text-sm font-bold rounded-md transition-colors \${
                        orderStatusTab === "archived"
                          ? "bg-white text-slate-800 shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                      }\`}
                    >
                      Архив
                    </button>
                  </div>`
);

// 4. Update orders mapping
code = code.replace(
  /orders\.length > 0 \? \(/g,
  `displayedOrders.length > 0 ? (`
);
code = code.replace(
  /orders\.map\(/g,
  `displayedOrders.map(`
);

// 5. Update delete logic to be invisible for completed? The user said:
// "Убедись, что иконка "Корзины" (отправка в архив) при этом остается доступной (или скрывается только во вкладке "Архив", как мы делали ранее)."
// In the current code it says:
// {orderStatusTab !== 'archived' && (
//   <button ... Trash2>
// So it stays visible for both active and completed. That's fine.

fs.writeFileSync('src/LogistDashboardScreen.tsx', code);
