import { CityLabel } from './OperatorCityBar';
import { useNotificationFocus } from './notificationNavigation';
import OperatorCityBar from './OperatorCityBar';
import { operatorFetch, useOperatorCityStore } from './operatorCityStore';
import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Loader2,
  MapPin,
  Trash2,
  User2,
  Wallet,
} from "lucide-react";
import toast from "react-hot-toast";
import { useAuthStore } from "./store";
import { baseURL, handleApiError, orderStatusColors } from "./utils";
import { getOrderStatusText } from "./utils/statusMapper";
import OrderPaymentsPanel from './OrderPaymentsPanel';

interface AdminOrdersListScreenProps {
  role: "admin" | "logist";
}

interface AdminListOrder {
  id: string;
  client_name?: string | null;
  delivery_address?: string | null;
  address?: string | null;
  estimated_total_amount?: number;
  total_amount: number;
  delivery_cost?: number | null;
  status: string;
  created_at: string;
  is_deleted: boolean;
}

export default function AdminOrdersListScreen({
  role,
}: AdminOrdersListScreenProps) {
  const routeBase = role === "logist" ? "/logist" : "/admin";
  const cityId = useOperatorCityStore((state) => state.cityId);
  const token = useAuthStore((state) => state.token);
  const [orders, setOrders] = useState<AdminListOrder[]>([]);
  useNotificationFocus(orders);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchOrders = async () => {
    try {
      setIsLoading(true);
      const res = await operatorFetch(`${baseURL}/admin/orders?is_deleted=false`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const data = await res.json();
      setOrders(Array.isArray(data) ? data : []);
    } catch (error: any) {
      if (error?.name === "AbortError") return;
      toast.error(
        handleApiError(
          error,
          "Не удалось загрузить список заказов",
        ),
      );
      setOrders([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [token, cityId]);

  const handleHardDelete = async (orderId: string) => {
    if (
      !window.confirm(
        "ВНИМАНИЕ! Заказ будет удален из базы НАВСЕГДА. Продолжить?",
      )
    ) {
      return;
    }

    try {
      setDeletingId(orderId);
      const res = await operatorFetch(`${baseURL}/admin/orders/${orderId}/hard`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => null);
        throw new Error(
          errorBody?.detail?.message ||
            errorBody?.detail ||
            errorBody?.message ||
            `Server returned ${res.status}`,
        );
      }

      toast.success("Заказ удален навсегда");
      await fetchOrders();
    } catch (error: any) {
      if (error?.name === "AbortError") return;
      toast.error(
        handleApiError(
          error,
          "Не удалось удалить заказ навсегда",
        ),
      );
    } finally {
      setDeletingId(null);
    }
  };

  const sortedOrders = useMemo(
    () =>
      [...orders].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [orders],
  );

  return (
    <div className="min-h-screen bg-slate-50 w-full">
      <div className="w-full max-w-7xl mx-auto flex flex-col min-h-screen">
        <div className="px-4 sm:px-6 lg:px-8 py-4 pt-[max(env(safe-area-inset-top),2.5rem)] border-b border-slate-100 bg-white sticky top-0 z-10">
          <a
            href={routeBase}
            className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {"Назад"}
          </a>
          <div className="mt-4 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900">
                {"Реестр заказов администратора"}
              </h1>
              <p className="text-sm text-slate-500 max-w-2xl">
                {
                  "Все активные записи из базы с возможностью hard delete."
                }
              </p>
            </div>
            <div className="inline-flex h-11 px-4 rounded-2xl bg-slate-100 items-center text-sm font-bold text-slate-600 w-fit">
              {"Всего:"} {sortedOrders.length}
            </div>
          </div>
        </div>

        <OperatorCityBar />
        <div className="flex-1 px-4 sm:px-6 lg:px-8 py-5 sm:py-6">
          {isLoading ? (
            <div className="min-h-[320px] flex items-center justify-center text-slate-500 gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-sky-500" />
              <span className="font-semibold">
                {"Загрузка заказов..."}
              </span>
            </div>
          ) : sortedOrders.length === 0 ? (
            <div className="min-h-[320px] rounded-3xl border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-slate-500 font-semibold">
              {"Активных заказов не найдено."}
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-4 lg:gap-5 items-start">
              {sortedOrders.map((order) => {
                const total = Number(
                  order.estimated_total_amount ??
                    (Number(order.total_amount || 0) +
                      Number(order.delivery_cost || 0)),
                );
                const address =
                  order.delivery_address ||
                  order.address ||
                  "Адрес не указан";
                const statusKey = order.status?.toLowerCase?.() || order.status;

                return (
                  <div
                    key={order.id}
                        data-order-id={order.id}
                    className="rounded-3xl border border-slate-200 bg-white shadow-sm p-5 lg:p-6 flex flex-col gap-4 h-full"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                          {"Заказ"}
                        </p>
                        <p className="text-lg font-black text-slate-900 mt-1 break-all">
                          #{order.id.slice(0, 8)} <CityLabel cityId={(order as any).city_id} cityName={(order as any).city_name} />
                        </p>
                      </div>
                      <div
                        className={`px-3 py-1 rounded-full text-xs font-bold ${
                          orderStatusColors[statusKey] ||
                          "bg-slate-100 text-slate-700 border border-slate-200"
                        }`}
                      >
                        {getOrderStatusText(order.status)}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3">
                        <div className="flex items-center gap-2 text-slate-400 text-xs font-bold uppercase tracking-[0.16em]">
                          <CalendarDays className="w-4 h-4" />
                          {"Дата"}
                        </div>
                        <p className="mt-2 text-sm font-bold text-slate-800">
                          {new Date(order.created_at).toLocaleString("ru-RU")}
                        </p>
                      </div>

                      <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3">
                        <div className="flex items-center gap-2 text-slate-400 text-xs font-bold uppercase tracking-[0.16em]">
                          <User2 className="w-4 h-4" />
                          {"Клиент"}
                        </div>
                        <p className="mt-2 text-sm font-bold text-slate-800 break-words">
                          {order.client_name || "Не указан"}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3">
                      <div className="flex items-center gap-2 text-slate-400 text-xs font-bold uppercase tracking-[0.16em]">
                        <MapPin className="w-4 h-4" />
                        {"Адрес"}
                      </div>
                      <p className="mt-2 text-sm font-bold text-slate-800 leading-relaxed break-words">
                        {address}
                      </p>
                    </div>

                    <OrderPaymentsPanel orderId={order.id} materialAmount={order.total_amount} deliveryAmount={order.delivery_cost || 0} />
                    <div className="flex items-center justify-between rounded-2xl bg-sky-50 border border-sky-100 p-4 mt-auto">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-500">
                          {"Сумма"}
                        </p>
                        <p className="mt-2 text-2xl lg:text-3xl font-black text-sky-700">
                          {total.toLocaleString("ru-RU")} {"₽"}
                        </p>
                      </div>
                      <div className="w-12 h-12 rounded-2xl bg-white text-sky-600 flex items-center justify-center shadow-sm shrink-0">
                        <Wallet className="w-6 h-6" />
                      </div>
                    </div>

                    <button
                      onClick={() => handleHardDelete(order.id)}
                      disabled={deletingId === order.id}
                      className="w-full h-12 rounded-2xl bg-red-50 text-red-600 font-bold flex items-center justify-center gap-2 border border-red-100 hover:bg-red-100 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                      {deletingId === order.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                      {"Удалить"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
