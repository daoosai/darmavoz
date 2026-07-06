import React, { useEffect, useState } from "react";
import { getOrderStatusText } from "../../utils/statusMapper";
import { XCircle, Clock, Loader2, MapPin, Box, DollarSign } from "lucide-react";
import { baseURL } from "../../utils";
import { useAuthStore } from "../../store";

interface DriverHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  driverId: string | null;
  driverName: string;
}

interface OrderOut {
  id: string;
  created_at: string;
  delivery_address: string;
  estimated_total_amount: number;
  status: string;
  items?: { material?: { name: string } }[];
}


const ORDER_STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-100 text-green-800 border-green-200",
  delivered: "bg-emerald-100 text-emerald-800 border-emerald-200",
  canceled: "bg-red-100 text-red-800 border-red-200",
  cancelled: "bg-red-100 text-red-800 border-red-200",
  driver_cancel: "bg-red-100 text-red-800 border-red-200",
  searching: "bg-gray-100 text-gray-800 border-gray-200",
  default: "bg-blue-100 text-blue-800 border-blue-200",
};

export const DriverHistoryModal: React.FC<DriverHistoryModalProps> = ({
  isOpen,
  onClose,
  driverId,
  driverName,
}) => {
  const [orders, setOrders] = useState<OrderOut[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const token = useAuthStore((state) => state.token);

  useEffect(() => {
    if (isOpen && driverId) {
      fetchHistory();
    } else {
      setOrders([]);
    }
  }, [isOpen, driverId]);

  const fetchHistory = async () => {
    try {
      setIsLoading(true);
      console.log("Fetching orders for driver_id:", driverId);
      const res = await fetch(`${baseURL}/admin/orders?driver_id=${driverId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const errorText = await res.text();
        console.error("Fetch History Error Body:", errorText);
        throw new Error(`Failed to fetch driver history: ${res.status}`);
      }
      const data = await res.json();
      console.log("Orders received:", data);
      setOrders(Array.isArray(data) ? data : data.items || data.results || []);
    } catch (error: any) {
      console.error("Fetch History Error:", error);
      setOrders([]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[80vh]">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="text-xl font-bold text-slate-800">
            История заказов: {driverName || "Неизвестно"}
          </h3>
          <button
            onClick={onClose}
            className="p-2 bg-white rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors shadow-sm border border-slate-200"
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1 bg-slate-50/50">
          {isLoading ? (
            <div className="flex justify-center items-center h-40">
              <Loader2 className="w-8 h-8 animate-spin text-[#2DB0E6]" />
            </div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate-500">
              <Clock className="w-12 h-12 text-slate-300 mb-3" />
              <p className="font-medium text-slate-600">
                История заказов пуста
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {orders.map((order) => {
                const date = new Date(order.created_at).toLocaleString(
                  "ru-RU",
                  {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  },
                );
                const address = order.delivery_address || "Адрес не указан";
                const materialName =
                  order.items?.[0]?.material?.name || "Материал не указан";
                const amount = order.estimated_total_amount || 0;
                const statusKey = order.status?.toLowerCase() || "";
                const statusText =
                  getOrderStatusText(statusKey) || order.status || "Неизвестно";
                const statusColor =
                  ORDER_STATUS_COLORS[statusKey] || ORDER_STATUS_COLORS.default;

                return (
                  <div
                    key={order.id}
                    className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col md:flex-row gap-4 justify-between items-start md:items-center"
                  >
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
                        <Clock className="w-4 h-4" />
                        {date}
                      </div>
                      <div className="flex items-center gap-2 text-slate-700">
                        <MapPin className="w-4 h-4 text-emerald-500" />
                        <span className="font-semibold">{address}</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-700">
                        <Box className="w-4 h-4 text-amber-500" />
                        <span>{materialName}</span>
                      </div>
                    </div>
                    <div className="flex flex-row md:flex-col items-center md:items-end justify-between w-full md:w-auto gap-2">
                      <div className="flex items-center gap-1 font-bold text-lg text-slate-800">
                        {amount} ₽
                      </div>
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-bold uppercase border ${statusColor}`}
                      >
                        {statusText}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
