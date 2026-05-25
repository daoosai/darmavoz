import React, { useState, useEffect } from 'react';
import { Package, MapPin, Calendar, Truck, List, Info } from 'lucide-react';

interface GuestOrder {
  id: string;
  materialName: string;
  volume: string;
  address: string;
  totalPrice: number;
  status: string;
  date: string;
}

export default function OrdersScreen() {
  const [orders, setOrders] = useState<GuestOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Simulate slight loading for better UX
    const timer = setTimeout(() => {
      const storedOrders = JSON.parse(localStorage.getItem("guest_orders") || "[]");
      setOrders(storedOrders);
      setIsLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, []);

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
      
      {/* Guest Mode Banner */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex items-start gap-3 mb-5">
        <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
        <p className="text-sm text-blue-800 leading-snug font-medium">
          Гостевой режим. Ваши заказы сохранены на этом устройстве.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {orders.map((order) => {
          const shortId = order.id ? order.id.slice(-4).toUpperCase() : '????';

          return (
            <div key={order.id} className="bg-white rounded-[20px] p-4 shadow-sm border border-slate-100 flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-slate-50 pb-3">
                <span className="font-bold text-slate-900 text-sm">Заказ № {shortId}</span>
                <span className="px-2 py-1 bg-blue-100 text-blue-800 text-[10px] font-bold rounded-full uppercase tracking-wider">
                  {order.status}
                </span>
              </div>
              
              <div className="flex flex-col gap-2.5">
                <div className="flex items-start gap-2.5">
                  <div className="w-8 h-8 bg-slate-50 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                    <Truck className="w-4 h-4 text-slate-500" />
                  </div>
                  <div className="flex-1">
                    <span className="text-sm font-medium text-slate-900">{order.materialName} • {order.volume}</span>
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
                  <span className="text-xs font-medium">{formatDate(order.date)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="font-bold text-[#2DB0E6] text-base">{order.totalPrice ? `${order.totalPrice} ₽` : '...'}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
