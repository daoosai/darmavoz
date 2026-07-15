import { useEffect, useMemo } from "react";
import { Package, Truck } from "lucide-react";
import { useAuthStore, useClientOrdersStore } from "./store";
import { baseURL } from "./utils";

interface Props {
  onOpenOrder: (orderId: string) => void;
}

const ORDER_PROGRESS: Record<string, { percentage: number; text: string }> = {
  created: { percentage: 20, text: "Ищем водителя..." },
  searching_driver: { percentage: 20, text: "Ищем водителя..." },
  offered_to_driver: { percentage: 20, text: "Ищем водителя..." },
  no_driver_found: { percentage: 20, text: "Ищем водителя..." },
  driver_assigned: { percentage: 40, text: "Машина едет на погрузку" },
  driver_accepted: { percentage: 40, text: "Машина едет на погрузку" },
  heading_to_pickup: { percentage: 40, text: "Машина едет на погрузку" },
  arrived_at_pickup: { percentage: 60, text: "Идет загрузка материала" },
  loading: { percentage: 60, text: "Идет загрузка материала" },
  heading_to_client: { percentage: 80, text: "Машина едет к вам!" },
  delivered: { percentage: 100, text: "Машина прибыла на объект" },
};

export default function FloatingOrderTracker({ onOpenOrder }: Props) {
  const { role, token } = useAuthStore();
  const { orders, setOrders, setIsLoading, clearOrders } = useClientOrdersStore();

  useEffect(() => {
    if (role !== "client" || !token) {
      clearOrders();
      return;
    }

    let isMounted = true;
    const loadOrders = async () => {
      try {
        const response = await fetch(`${baseURL}/clients/me/orders`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!isMounted) return;
        if (response.ok) {
          const payload = await response.json();
          setOrders(Array.isArray(payload) ? payload : []);
        } else if (response.status === 401 || response.status === 403) {
          clearOrders();
        }
      } catch {
        // Keep the last known order visible during a temporary network failure.
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    setIsLoading(true);
    void loadOrders();
    const intervalId = window.setInterval(loadOrders, 5000);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [clearOrders, role, setIsLoading, setOrders, token]);

  const activeOrder = useMemo(
    () => orders
      .filter((order) => ORDER_PROGRESS[order.status])
      .sort(
        (first, second) =>
          new Date(second.created_at).getTime() - new Date(first.created_at).getTime(),
      )[0],
    [orders],
  );

  if (!activeOrder) return null;

  const progress = ORDER_PROGRESS[activeOrder.status];
  const materialName = activeOrder.items?.[0]?.material?.name || "Активный заказ";

  return (
    <button
      type="button"
      onClick={() => onOpenOrder(activeOrder.id)}
      className="fixed bottom-20 left-4 right-4 z-50 mx-auto max-w-[416px] cursor-pointer rounded-2xl border border-gray-100 bg-white p-4 text-left shadow-xl transition-transform active:scale-[0.98]"
      aria-label={`Открыть активный заказ: ${materialName}`}
    >
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-500">
          {progress.percentage >= 40 ? <Truck className="h-5 w-5" /> : <Package className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-500">{materialName}</p>
          <p className="truncate font-bold text-slate-900">{progress.text}</p>
        </div>
        <span className="text-sm font-black text-sky-600">{progress.percentage}%</span>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full bg-sky-500 transition-all duration-500"
          style={{ width: `${progress.percentage}%` }}
        />
      </div>
    </button>
  );
}
