const fs = require('fs');
let code = fs.readFileSync('src/LogistDashboardScreen.tsx', 'utf8');

const regex = /const activeOrders = orders\.filter\(o =>[\s\S]*?const displayedOrders = orderStatusTab === 'active'[\s\S]*?: orders;/g;
code = code.replace(regex, '');

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

code = code.replace('  return (', filterLogic + '\n  return (');

fs.writeFileSync('src/LogistDashboardScreen.tsx', code);
