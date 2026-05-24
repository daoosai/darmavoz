import React, { useState, useEffect } from 'react';
import { Package, MapPin, Calendar, Truck, List } from 'lucide-react';

interface OrderItem {
  material_name?: string;
  capacity_m3?: number;
}

interface Order {
  id: string;
  status: string;
  total_amount: number;
  created_at: string;
  address: string;
  items?: OrderItem[];
  delivery_option?: {
    capacity_m3?: number;
    title?: string;
  };
  material?: {
    name?: string;
  };
}

const statusMap: Record<string, { label: string, color: string }> = {
  'draft': { label: 'Черновик', color: 'bg-yellow-100 text-yellow-800' },
  'pending': { label: 'В обработке', color: 'bg-blue-100 text-blue-800' },
  'accepted': { label: 'Принят', color: 'bg-indigo-100 text-indigo-800' },
  'in_progress': { label: 'В работе', color: 'bg-purple-100 text-purple-800' },
  'done': { label: 'Завершен', color: 'bg-green-100 text-green-800' },
  'canceled': { label: 'Отменен', color: 'bg-red-100 text-red-800' },
};

export default function OrdersScreen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchOrders = async () => {
      try {
        setIsLoading(true);
        const res = await fetch('/api/v1/orders', {
          headers: {
            'Authorization': 'Bearer demo-token'
          }
        });
        if (res.ok) {
          const data = await res.json();
          // Assuming API returns array or { results: array }
          setOrders(Array.isArray(data) ? data : data.results || []);
        } else {
          console.error("Failed to fetch orders, status: " + res.status);
          alert("Ошибка загрузки заказов: " + res.status);
        }
      } catch (err) {
        console.error("Error fetching orders:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchOrders();
  }, []);

  const getStatusBadge = (status: string) => {
    const mapped = statusMap[status] || { label: status, color: 'bg-slate-100 text-slate-700' };
    
    return (
      <span className={`px-2 py-1 ${mapped.color} text-[10px] font-bold rounded-full uppercase tracking-wider`}>
        {mapped.label}
      </span>
    );
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-full gap-3 opacity-60">
        <List className="w-12 h-12 text-slate-300 animate-pulse" />
        <span className="text-slate-500 font-medium text-sm animate-pulse">Загрузка заказов...</span>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center h-full min-h-[400px]">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
          <List className="w-8 h-8 text-slate-400" />
        </div>
        <h3 className="text-lg font-semibold text-slate-900 mb-1">У вас пока нет заказов</h3>
        <p className="text-sm text-slate-500">Здесь будет отображаться история ваших покупок и активные доставки.</p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-6 relative">
      <h2 className="text-2xl font-bold text-slate-900 mb-4 pt-2">Ваши заказы</h2>
      <div className="flex flex-col gap-4">
        {orders.map((order) => {
          const shortId = order.id ? order.id.slice(-4).toUpperCase() : '????';
          const capacity = order.items?.[0]?.capacity_m3 || order.delivery_option?.capacity_m3;
          const materialName = order.items?.[0]?.material_name || order.material?.name || order.items?.[0]?.material?.name;
          const materialDisplay = materialName || 'Нет данных';
          const capacityDisplay = capacity ? `${capacity} м³` : 'Нет данных';

          return (
            <div key={order.id} className="bg-white rounded-[20px] p-4 shadow-sm border border-slate-100 flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-slate-50 pb-3">
                <span className="font-bold text-slate-900 text-sm">Заказ № {shortId}</span>
                {getStatusBadge(order.status)}
              </div>
              
              <div className="flex flex-col gap-2.5">
                <div className="flex items-start gap-2.5">
                  <div className="w-8 h-8 bg-slate-50 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                    <Truck className="w-4 h-4 text-slate-500" />
                  </div>
                  <div className="flex-1">
                    <span className="text-sm font-medium text-slate-900">{materialDisplay} • {capacityDisplay}</span>
                  </div>
                </div>
                
                <div className="flex items-start gap-2.5">
                  <div className="w-8 h-8 bg-slate-50 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                    <MapPin className="w-4 h-4 text-slate-500" />
                  </div>
                  <div className="flex-1">
                    <span className="text-sm text-slate-600 leading-snug">{order.address || 'Адрес не указан'}</span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center justify-between border-t border-slate-50 pt-3 mt-1">
                <div className="flex items-center gap-1.5 text-slate-500">
                  <Calendar className="w-4 h-4" />
                  <span className="text-xs font-medium">{formatDate(order.created_at)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="font-bold text-[#2DB0E6] text-base">{order.total_amount ? `${order.total_amount} ₽` : '...'}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
