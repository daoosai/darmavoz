const fs = require('fs');
let code = fs.readFileSync('src/DriverOrdersScreen.tsx', 'utf8');

// 1. Bug 1: Delete "toast.error("Координаты отсутствуют");" if it exists in background... wait, I will rewrite openNavigator which will have it, but maybe I should check if there's any other "Координаты отсутствуют" anywhere. We already checked and it was ONLY in openNavigator. So replacing openNavigator will fix Bug 1, 2 and 4.

// Fix Bug 2 & 4: Rewrite openNavigator and its calls
const openNavigatorRegex = /const openNavigator = async \(\) => \{[\s\S]*?toast\.error\("Координаты отсутствуют"\);\n    \}\n  \};/m;
const newOpenNavigator = `const openNavigator = async (type: 'quarry' | 'client') => {
    if (order.status === 'driver_assigned' || order.status === 'driver_accepted') {
        await updateStatus('heading_to_pickup');
    }

    const lat = type === 'quarry' ? order.pickup_lat : order.delivery_lat;
    const lon = type === 'quarry' ? order.pickup_lon : order.delivery_lon;
    const address = type === 'quarry' ? order.pickup_address : order.delivery_address;

    if (lat && lon) {
      window.location.href = \`https://2gis.ru/routeSearch/rsType/car/to/\${lon},\${lat}\`;
    } else if (address) {
      window.location.href = \`https://2gis.ru/routeSearch/rsType/car/to/\${encodeURIComponent(address)}\`;
    } else {
      toast.error("Нет данных для построения маршрута");
    }
  };`;

code = code.replace(openNavigatorRegex, newOpenNavigator);

// Fix openNavigator calls
// For "driver_assigned" / "driver_accepted":
code = code.replace(
  /\{\(order\.status === "driver_assigned" \|\| order\.status === "driver_accepted"\) && \([\s\S]*?onClick=\{openNavigator\}[\s\S]*?"Выехать на карьер"/m,
  match => match.replace('onClick={openNavigator}', 'onClick={() => openNavigator(\'quarry\')}')
);

// For "heading_to_pickup":
code = code.replace(
  /\{order\.status === "heading_to_pickup" && \([\s\S]*?onClick=\{openNavigator\}[\s\S]*?Открыть навигатор/m,
  match => match.replace('onClick={openNavigator}', 'onClick={() => openNavigator(\'quarry\')}')
);

// For "heading_to_client":
code = code.replace(
  /\{order\.status === "heading_to_client" && \([\s\S]*?onClick=\{openNavigator\}[\s\S]*?Открыть навигатор/m,
  match => match.replace('onClick={openNavigator}', 'onClick={() => openNavigator(\'client\')}')
);

// Bug 3: Remove "loading" button, change "arrived_at_pickup" button
// Replace "arrived_at_pickup" button logic
const arrivedBlockRegex = /\{order\.status === "arrived_at_pickup" && \(\s*<>\s*<button[\s\S]*?onClick=\{\(\) => updateStatus\("loading"\)\}[\s\S]*?"Начать погрузку"\s*\n\s*\)\}\s*<\/button>\s*<\/>\s*\)\}/m;

const newArrivedBlock = `{order.status === "arrived_at_pickup" && (
              <>
                <button
                  disabled={isUpdating}
                  onClick={() => updateStatus("heading_to_client")}
                  className="w-full h-14 bg-sky-500 active:bg-sky-600 text-white text-lg font-bold rounded-xl shadow-md transition-transform active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isUpdating ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    "Загрузился, еду к клиенту"
                  )}
                </button>
              </>
            )}`;

code = code.replace(arrivedBlockRegex, newArrivedBlock);

// Remove "loading" block
const loadingBlockRegex = /\s*\{order\.status === "loading" && \(\s*<>\s*<button[\s\S]*?onClick=\{\(\) => updateStatus\("heading_to_client"\)\}[\s\S]*?"Загрузился, еду к клиенту"\s*\n\s*\)\}\s*<\/button>\s*<\/>\s*\)\}/m;
code = code.replace(loadingBlockRegex, '');

fs.writeFileSync('src/DriverOrdersScreen.tsx', code);
