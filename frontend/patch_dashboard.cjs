const fs = require('fs');
let code = fs.readFileSync('src/LogistDashboardScreen.tsx', 'utf8');

code = code.replace(
  'const [isCreateOpen, setIsCreateOpen] = useState(false);',
  'const [isCreateOpen, setIsCreateOpen] = useState(false);\n  const [editingOrder, setEditingOrder] = useState<AdminOrder | null>(null);\n  const [orderStatusTab, setOrderStatusTab] = useState<"active" | "archived">("active");'
);

// Update fetchOrders
code = code.replace(
  'if (orderDateFilter) {\n        url.searchParams.append("date", orderDateFilter);\n      }',
  'if (orderDateFilter) {\n        url.searchParams.append("date", orderDateFilter);\n      }\n      if (orderStatusTab === "archived") {\n        url.searchParams.append("is_deleted", "true");\n      }'
);

// Update useEffect dependencies
code = code.replace(
  '}, [orderDateFilter]);',
  '}, [orderDateFilter, orderStatusTab]);'
);

// Add tabs
code = code.replace(
  '<h2 className="text-xl font-bold text-slate-800">Все заказы</h2>',
  `<div className="flex flex-col gap-2">
                  <h2 className="text-xl font-bold text-slate-800">Все заказы</h2>
                  <div className="flex bg-slate-100 p-1 rounded-lg self-start">
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
                      onClick={() => setOrderStatusTab("archived")}
                      className={\`px-3 py-1.5 text-sm font-bold rounded-md transition-colors \${
                        orderStatusTab === "archived"
                          ? "bg-white text-slate-800 shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                      }\`}
                    >
                      Архив
                    </button>
                  </div>
                </div>`
);

// Add edit button and conditionally show delete
code = code.replace(
  '<button\n                              onClick={() => handleDeleteOrder(order.id)}\n                              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-100"\n                              title="Удалить заказ"\n                            >\n                              <Trash2 className="w-4 h-4" />\n                            </button>',
  `{orderStatusTab !== 'archived' && (
                              <>
                                <button
                                  onClick={() => setEditingOrder(order)}
                                  className="p-1.5 text-slate-400 hover:text-[#2DB0E6] hover:bg-[#2DB0E6]/10 rounded-lg transition-colors border border-transparent hover:border-[#2DB0E6]/20"
                                  title="Редактировать заказ"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteOrder(order.id)}
                                  className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-100"
                                  title="В архив"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            )}`
);

// Add the modal component at the end just before <LogistCreateOrderModal
code = code.replace(
  '{/* Create Order Modal */}',
  `{/* Edit Order Modal */}
      <LogistEditOrderModal
        isOpen={!!editingOrder}
        onClose={() => setEditingOrder(null)}
        token={token}
        materials={materials}
        deliveryOptions={deliveryOptions}
        order={editingOrder}
        onOrderUpdated={() => {
          fetchOrders(true);
          setEditingOrder(null);
        }}
      />
      {/* Create Order Modal */}`
);

fs.writeFileSync('src/LogistDashboardScreen.tsx', code);
