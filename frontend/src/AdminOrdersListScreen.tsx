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
  const token = useAuthStore((state) => state.token);
  const [orders, setOrders] = useState<AdminListOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchOrders = async () => {
    try {
      setIsLoading(true);
      const res = await fetch(`${baseURL}/admin/orders?is_deleted=false`, {
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
      toast.error(
        handleApiError(
          error,
          "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0441\u043f\u0438\u0441\u043e\u043a \u0437\u0430\u043a\u0430\u0437\u043e\u0432",
        ),
      );
      setOrders([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [token]);

  const handleHardDelete = async (orderId: string) => {
    if (
      !window.confirm(
        "\u0412\u041d\u0418\u041c\u0410\u041d\u0418\u0415! \u0417\u0430\u043a\u0430\u0437 \u0431\u0443\u0434\u0435\u0442 \u0443\u0434\u0430\u043b\u0435\u043d \u0438\u0437 \u0431\u0430\u0437\u044b \u041d\u0410\u0412\u0421\u0415\u0413\u0414\u0410. \u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c?",
      )
    ) {
      return;
    }

    try {
      setDeletingId(orderId);
      const res = await fetch(`${baseURL}/admin/orders/${orderId}/hard`, {
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

      toast.success("\u0417\u0430\u043a\u0430\u0437 \u0443\u0434\u0430\u043b\u0435\u043d \u043d\u0430\u0432\u0441\u0435\u0433\u0434\u0430");
      await fetchOrders();
    } catch (error: any) {
      toast.error(
        handleApiError(
          error,
          "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0443\u0434\u0430\u043b\u0438\u0442\u044c \u0437\u0430\u043a\u0430\u0437 \u043d\u0430\u0432\u0441\u0435\u0433\u0434\u0430",
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
    <div className="min-h-screen bg-slate-50 flex sm:items-center justify-center px-4 py-6">
      <div className="w-full max-w-5xl bg-white min-h-[70vh] sm:min-h-0 sm:h-auto sm:rounded-[32px] sm:border-8 border-slate-900 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-white sticky top-0 z-10">
          <a
            href={routeBase}
            className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {"\u041d\u0430\u0437\u0430\u0434"}
          </a>
          <div className="mt-4 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-black text-slate-900">
                {"\u0420\u0435\u0435\u0441\u0442\u0440 \u0437\u0430\u043a\u0430\u0437\u043e\u0432 \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0430"}
              </h1>
              <p className="text-sm text-slate-500">
                {
                  "\u0412\u0441\u0435 \u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0435 \u0437\u0430\u043f\u0438\u0441\u0438 \u0438\u0437 \u0431\u0430\u0437\u044b \u0441 \u0432\u043e\u0437\u043c\u043e\u0436\u043d\u043e\u0441\u0442\u044c\u044e hard delete."
                }
              </p>
            </div>
            <div className="hidden sm:flex h-12 px-4 rounded-2xl bg-slate-100 items-center text-sm font-bold text-slate-600">
              {"\u0412\u0441\u0435\u0433\u043e:"} {sortedOrders.length}
            </div>
          </div>
        </div>

        <div className="p-5">
          {isLoading ? (
            <div className="min-h-[320px] flex items-center justify-center text-slate-500 gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-sky-500" />
              <span className="font-semibold">
                {"\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0437\u0430\u043a\u0430\u0437\u043e\u0432..."}
              </span>
            </div>
          ) : sortedOrders.length === 0 ? (
            <div className="min-h-[320px] rounded-3xl border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-slate-500 font-semibold">
              {"\u0410\u043a\u0442\u0438\u0432\u043d\u044b\u0445 \u0437\u0430\u043a\u0430\u0437\u043e\u0432 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e."}
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {sortedOrders.map((order) => {
                const total = Number(
                  order.estimated_total_amount ??
                    (Number(order.total_amount || 0) +
                      Number(order.delivery_cost || 0)),
                );
                const address =
                  order.delivery_address ||
                  order.address ||
                  "\u0410\u0434\u0440\u0435\u0441 \u043d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d";
                const statusKey = order.status?.toLowerCase?.() || order.status;

                return (
                  <div
                    key={order.id}
                    className="rounded-3xl border border-slate-200 bg-white shadow-sm p-5 flex flex-col gap-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                          {"\u0417\u0430\u043a\u0430\u0437"}
                        </p>
                        <p className="text-lg font-black text-slate-900 mt-1">
                          #{order.id.slice(0, 8)}
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
                          {"\u0414\u0430\u0442\u0430"}
                        </div>
                        <p className="mt-2 text-sm font-bold text-slate-800">
                          {new Date(order.created_at).toLocaleString("ru-RU")}
                        </p>
                      </div>

                      <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3">
                        <div className="flex items-center gap-2 text-slate-400 text-xs font-bold uppercase tracking-[0.16em]">
                          <User2 className="w-4 h-4" />
                          {"\u041a\u043b\u0438\u0435\u043d\u0442"}
                        </div>
                        <p className="mt-2 text-sm font-bold text-slate-800">
                          {order.client_name || "\u041d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d"}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3">
                      <div className="flex items-center gap-2 text-slate-400 text-xs font-bold uppercase tracking-[0.16em]">
                        <MapPin className="w-4 h-4" />
                        {"\u0410\u0434\u0440\u0435\u0441"}
                      </div>
                      <p className="mt-2 text-sm font-bold text-slate-800 leading-relaxed">
                        {address}
                      </p>
                    </div>

                    <div className="flex items-center justify-between rounded-2xl bg-sky-50 border border-sky-100 p-4">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-500">
                          {"\u0421\u0443\u043c\u043c\u0430"}
                        </p>
                        <p className="mt-2 text-2xl font-black text-sky-700">
                          {total.toLocaleString("ru-RU")} {"\u20bd"}
                        </p>
                      </div>
                      <div className="w-12 h-12 rounded-2xl bg-white text-sky-600 flex items-center justify-center shadow-sm">
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
                      {"\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u043d\u0430\u0432\u0441\u0435\u0433\u0434\u0430"}
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
