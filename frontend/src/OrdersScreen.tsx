import React, { useState, useEffect } from "react";
import PullToRefresh from "react-simple-pull-to-refresh";
import { Package, MapPin, Calendar, Truck, List, Info, User as UserIcon, Phone } from "lucide-react";
import { clientOrderStatusMap, clientOrderStatusColors, baseURL } from "./utils";
import { useAuthStore } from "./store";

interface ClientOrder {
  id: string;
  status: string;
  address: string;
  total_amount: number;
  created_at: string;
  driver?: {
    name: string;
    phone: string;
  };
  items?: {
    material: { name: string };
    quantity: number;
  }[];
  delivery_option?: {
    capacity_m3: number;
    title: string;
  };
}

export default function OrdersScreen({ onOpenAuth }: { onOpenAuth?: () => void }) {
  const { role, token } = useAuthStore();
  const [orders, setOrders] = useState<ClientOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchOrders = async () => {
    if (role !== "client") {
      setOrders([]);
      setIsLoading(false);
      return;
    }
    
    try {
      const res = await fetch(`${baseURL}/clients/me/orders`, {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setOrders(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [role, token]);

  const handleRefresh = async () => {
    await fetchOrders();
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return dateString;
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-full gap-3 opacity-60">
        <List className="w-12 h-12 text-slate-300 animate-pulse" />
        <span className="text-slate-500 font-medium text-sm animate-pulse">
          Загрузка заказов...
        </span>
      </div>
    );
  }

  if (role !== "client") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center h-full min-h-[400px]">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
          <Info className="w-8 h-8 text-slate-400" />
        </div>
        <h3 className="text-lg font-semibold text-slate-900 mb-2">
          Вы не авторизованы
        </h3>
        <p className="text-sm text-slate-500 mb-6">
          Войдите или зарегистрируйтесь, чтобы увидеть историю своих заказов
        </p>
        <button
          onClick={onOpenAuth}
          className="bg-[#2DB0E6] text-white px-8 py-3 rounded-full font-medium shadow-sm active:bg-[#209dd0] transition-colors"
        >
          Вход / Регистрация
        </button>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="h-full">
        <PullToRefresh onRefresh={handleRefresh} pullingContent={""} refreshingContent={<div className="p-4 text-center text-slate-500 text-sm">Обновление...</div>}>
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center h-full min-h-[400px]">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
              <List className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 mb-1">
              У вас пока нет заказов
            </h3>
            <p className="text-sm text-slate-500">
              Здесь будет отображаться история ваших покупок и активные доставки.
            </p>
          </div>
        </PullToRefresh>
      </div>
    );
  }

  return (
    <div className="px-4 pb-6 relative h-full">
      <h2 className="text-2xl font-bold text-slate-900 mb-4 pt-2">
        Ваши заказы
      </h2>

      <PullToRefresh onRefresh={handleRefresh} pullingContent={""} refreshingContent={<div className="p-4 text-center text-slate-500 text-sm">Обновление...</div>}>
        <div className="flex flex-col gap-4 pb-12">
          {orders.map((order) => {
            const shortId = order.id ? order.id.slice(-4).toUpperCase() : "????";
            const materialName = order.items?.[0]?.material?.name || "Материал не указан";
            const volume = order.delivery_option?.capacity_m3 ? `${order.delivery_option.capacity_m3} м³` : "";
            const quantity = order.items?.[0]?.quantity || 1;
            const hasDriver = !!order.driver;
            const showDriver = order.status === "driver_assigned" || order.status === "in_progress";

            return (
              <div
                key={order.id}
                className="bg-white rounded-[20px] p-4 shadow-sm border border-slate-100 flex flex-col gap-3"
              >
                <div className="flex items-center justify-between border-b border-slate-50 pb-3">
                  <span className="font-bold text-slate-900 text-sm">
                    Заказ № {shortId}
                  </span>
                  <span
                    className={`px-2.5 py-1 text-[10px] font-bold rounded-lg uppercase tracking-wide border ${
                      clientOrderStatusColors[order.status] || "bg-slate-100 text-slate-600 border border-slate-200"
                    }`}
                  >
                    {clientOrderStatusMap[order.status] || order.status.toUpperCase()}
                  </span>
                </div>

                <div className="flex flex-col gap-2.5">
                  <div className="flex items-start gap-2.5">
                    <div className="w-8 h-8 bg-slate-50 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                      <Truck className="w-4 h-4 text-slate-500" />
                    </div>
                    <div className="flex-1">
                      <span className="text-sm font-medium text-slate-900 block">
                        {materialName} {volume && `• ${volume}`}
                      </span>
                      <span className="text-xs text-slate-500 mt-0.5 block">
                        Кол-во машин: {quantity}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5">
                    <div className="w-8 h-8 bg-slate-50 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                      <MapPin className="w-4 h-4 text-slate-500" />
                    </div>
                    <div className="flex-1 mt-1.5">
                      <span className="text-sm text-slate-600 leading-snug">
                        {order.address || "Адрес не указан"}
                      </span>
                    </div>
                  </div>
                </div>

                {showDriver && hasDriver && (
                  <div className="bg-slate-50 rounded-xl p-3 flex flex-col gap-2 mt-1">
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Ваш водитель</div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-sm border border-slate-100">
                          <UserIcon className="w-4 h-4 text-slate-400" />
                        </div>
                        <span className="text-sm font-bold text-slate-800">{order.driver?.name}</span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between border-t border-slate-50 pt-3 mt-1">
                  <div className="flex items-center gap-1.5 text-slate-500">
                    <Calendar className="w-4 h-4" />
                    <span className="text-xs font-medium">
                      {formatDate(order.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-bold text-[#2DB0E6] text-base">
                      {order.total_amount ? `${order.total_amount} ₽` : "..."}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </PullToRefresh>
    </div>
  );
}
