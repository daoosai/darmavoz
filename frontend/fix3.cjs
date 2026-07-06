const fs = require('fs');
let code = fs.readFileSync('src/LogistDashboardScreen.tsx', 'utf8');

// First, remove ALL occurrences of the filter logic anywhere in the file
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

// Find the main return using a more specific match
// Usually it's after the getFirstName function
code = code.replace(
  /const getFirstName = \(fullName\?: string\) => \{[\s\S]*?return fullName;\n  \};\n/,
  match => match + '\n' + filterLogic + '\n'
);

fs.writeFileSync('src/LogistDashboardScreen.tsx', code);
