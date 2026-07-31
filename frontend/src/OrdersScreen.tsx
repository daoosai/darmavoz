import { useEffect, useState } from "react";
import PullToRefresh from "react-simple-pull-to-refresh";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Info, List, MapPin, Package, Truck } from "lucide-react";

import { baseURL, clientOrderStatusColors } from "./utils";
import { getOrderStatusText } from "./utils/statusMapper";
import {
  ClientOrderSummary,
  normalizeClientOrderSummary,
  useAuthStore,
  useClientOrdersStore,
} from "./store";

type ClientOrder = ClientOrderSummary;

const activeStatuses = new Set([
  "created",
  "searching_driver",
  "offered_to_driver",
  "no_driver_found",
  "driver_assigned",
  "driver_accepted",
  "heading_to_pickup",
  "arrived_at_pickup",
  "loading",
  "heading_to_client",
  "delivered",
]);

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "Дата не указана";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatAmount = (order: ClientOrder) => {
  const amount =
    typeof order.total_price === "number"
      ? order.total_price
      : typeof order.estimated_total_amount === "number"
        ? order.estimated_total_amount
        : typeof order.total_amount === "number"
          ? order.total_amount
          : null;

  return amount == null ? "По расчету" : `${Number(amount).toLocaleString("ru-RU")} ₽`;
};

const getOrderMaterialTitle = (order: ClientOrder) =>
  order.items?.[0]?.material?.name || "Материал не указан";

const getOrderQuantity = (order: ClientOrder) => order.items?.[0]?.quantity || 1;

function OrderCard({ order, compact = false }: { order: ClientOrder; compact?: boolean }) {
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
            Заказ #{order.id.slice(-6).toUpperCase()}
          </p>
          <h3 className="mt-1 text-lg font-black text-slate-900">{getOrderMaterialTitle(order)}</h3>
          <p className="mt-1 text-sm text-slate-500">
            {getOrderQuantity(order)} шт. · {order.delivery_option?.title || "Доставка"}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-bold ${
            clientOrderStatusColors[order.status] || "border border-slate-200 bg-slate-100 text-slate-600"
          }`}
        >
          {getOrderStatusText(order.status) || order.status}
        </span>
      </div>

      <div className={`mt-4 grid gap-3 ${compact ? "grid-cols-1" : "grid-cols-2"}`}>
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-xs text-slate-400">Сумма</p>
          <p className="mt-1 font-black text-slate-900">{formatAmount(order)}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-xs text-slate-400">Создан</p>
          <p className="mt-1 font-bold text-slate-700">{formatDateTime(order.created_at)}</p>
        </div>
      </div>

      {order.address ? (
        <p className="mt-4 flex items-start gap-2 text-sm text-slate-600">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          {order.address}
        </p>
      ) : null}

      {order.driver ? (
        <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Водитель</p>
          <p className="mt-1 font-bold text-slate-900">{order.driver.name}</p>
          <p className="text-sm text-slate-500">
            {order.driver.vehicle?.brand || order.driver.vehicle?.title || "Транспорт назначен"}
          </p>
        </div>
      ) : null}
    </motion.article>
  );
}

export default function OrdersScreen({
  onOpenAuth,
  focusedOrderId,
  onBackToOrders,
}: {
  onOpenAuth?: () => void;
  focusedOrderId?: string | null;
  onBackToOrders?: () => void;
}) {
  const { role, token } = useAuthStore();
  const { orders, isLoading, setOrders, setIsLoading, clearOrders } = useClientOrdersStore();
  const [activeTab, setActiveTab] = useState<"current" | "history">("current");

  const fetchOrders = async () => {
    if (role !== "client") {
      setOrders([]);
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch(`${baseURL}/clients/me/orders`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setOrders(Array.isArray(data) ? data.map(normalizeClientOrderSummary) : []);
      } else {
        setOrders([]);
      }
    } catch {
      setOrders([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (role !== "client") {
      clearOrders();
      return;
    }

    if (orders.length === 0) {
      void fetchOrders();
    }
  }, [clearOrders, orders.length, role, token]);

  useEffect(() => {
    if (focusedOrderId) {
      setActiveTab("current");
    }
  }, [focusedOrderId]);

  const handleRefresh = async () => {
    await fetchOrders();
  };

  const currentOrders = focusedOrderId
    ? orders.filter((order) => order.id === focusedOrderId)
    : orders.filter((order) => activeStatuses.has(order.status));

  const historyOrders = orders
    .filter((order) => !activeStatuses.has(order.status))
    .sort(
      (first, second) =>
        new Date(second.created_at).getTime() - new Date(first.created_at).getTime(),
    );

  if (isLoading && orders.length === 0) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 opacity-60">
        <List className="h-12 w-12 animate-pulse text-slate-300" />
        <span className="text-sm font-medium text-slate-500">Загрузка заказов...</span>
      </div>
    );
  }

  if (role !== "client") {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center px-4 text-center">
        <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-slate-100">
          <Info className="h-8 w-8 text-slate-400" />
        </div>
        <h3 className="mb-2 text-[22px] font-bold text-slate-900">Вы не авторизованы</h3>
        <p className="mb-8 max-w-[280px] text-base text-slate-500">
          Войдите или зарегистрируйтесь, чтобы увидеть историю своих заказов
        </p>
        <button
          type="button"
          onClick={onOpenAuth}
          className="w-full max-w-[280px] rounded-2xl bg-[#2DB0E6] px-8 py-4 font-bold text-white shadow-md shadow-[#2DB0E6]/20 transition-all active:scale-95"
        >
          Вход / Регистрация
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-68px)] bg-gray-50">
      <div className="relative z-10 bg-gray-50 px-4 pb-2 pt-4">
        {focusedOrderId ? (
          <button
            type="button"
            onClick={onBackToOrders}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm"
          >
            <ArrowLeft className="h-4 w-4" />
            Все заказы
          </button>
        ) : (
          <div className="flex rounded-2xl bg-slate-200/50 p-1">
            <button
              type="button"
              onClick={() => setActiveTab("current")}
              className={`flex-1 rounded-xl py-3 text-sm font-bold transition-all ${
                activeTab === "current"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Текущие
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className={`flex-1 rounded-xl py-3 text-sm font-bold transition-all ${
                activeTab === "history"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              История
            </button>
          </div>
        )}
      </div>

      <PullToRefresh
        onRefresh={handleRefresh}
        pullingContent=""
        refreshingContent={
          <div className="p-4 text-center text-sm text-slate-500">Обновление...</div>
        }
      >
        <div className="min-h-screen bg-gray-50 px-4 pb-24 pt-4">
          <AnimatePresence mode="wait">
            {activeTab === "current" ? (
              <motion.div
                key="current"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                {currentOrders.length > 0 ? (
                  <div className="flex flex-col gap-4">
                    {currentOrders.map((order) => (
                      <div key={order.id}>
                        <OrderCard order={order} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-[40vh] flex-col items-center justify-center p-6 text-center opacity-60">
                    <Truck className="mb-4 h-12 w-12 text-slate-300" />
                    <p className="font-medium text-slate-500">Нет текущих заказов</p>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="history"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
              >
                {historyOrders.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    {historyOrders.map((order) => (
                      <div key={order.id}>
                        <OrderCard order={order} compact />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-[40vh] flex-col items-center justify-center p-6 text-center opacity-60">
                    <Package className="mb-4 h-12 w-12 text-slate-300" />
                    <p className="font-medium text-slate-500">История заказов пуста</p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </PullToRefresh>
    </div>
  );
}
