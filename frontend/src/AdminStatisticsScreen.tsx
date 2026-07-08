import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  Loader2,
  Truck,
  Wallet,
  PackageCheck,
  ClipboardList,
} from "lucide-react";
import toast from "react-hot-toast";
import { useAuthStore } from "./store";
import { baseURL, handleApiError } from "./utils";

interface AdminStatisticsScreenProps {
  role: "admin" | "logist";
}

interface AdminStatistics {
  total_orders: number;
  completed_orders: number;
  total_revenue: number;
  total_drivers: number;
  active_drivers: number;
}

const initialStats: AdminStatistics = {
  total_orders: 0,
  completed_orders: 0,
  total_revenue: 0,
  total_drivers: 0,
  active_drivers: 0,
};

export default function AdminStatisticsScreen({
  role,
}: AdminStatisticsScreenProps) {
  const routeBase = role === "logist" ? "/logist" : "/admin";
  const title =
    role === "logist"
      ? "\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043a\u0430 \u043b\u043e\u0433\u0438\u0441\u0442\u0430"
      : "\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043a\u0430 \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0430";
  const token = useAuthStore((state) => state.token);
  const [stats, setStats] = useState<AdminStatistics>(initialStats);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchStatistics = async () => {
      try {
        setIsLoading(true);
        const res = await fetch(`${baseURL}/admin/statistics`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!res.ok) {
          throw new Error(`Server returned ${res.status}`);
        }

        const data = await res.json();
        setStats({
          total_orders: Number(data.total_orders || 0),
          completed_orders: Number(data.completed_orders || 0),
          total_revenue: Number(data.total_revenue || 0),
          total_drivers: Number(data.total_drivers || 0),
          active_drivers: Number(data.active_drivers || 0),
        });
      } catch (error: any) {
        toast.error(
          handleApiError(
            error,
            "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043a\u0443",
          ),
        );
      } finally {
        setIsLoading(false);
      }
    };

    fetchStatistics();
  }, [token]);

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 w-full max-w-md mx-auto">
      <div className="px-5 py-4 border-b border-slate-100 bg-white sticky top-0 z-10">
          <a
            href={routeBase}
            className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {"\u041d\u0430\u0437\u0430\u0434"}
          </a>
          <div className="mt-4 flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-sky-100 text-sky-600 flex items-center justify-center">
              <BarChart3 className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900">{title}</h1>
              <p className="text-sm text-slate-500">
                {
                  "\u041e\u043f\u0435\u0440\u0430\u0446\u0438\u043e\u043d\u043d\u0430\u044f \u0441\u0432\u043e\u0434\u043a\u0430 \u043f\u043e \u0437\u0430\u043a\u0430\u0437\u0430\u043c, \u0432\u044b\u0440\u0443\u0447\u043a\u0435 \u0438 \u0442\u0435\u043a\u0443\u0449\u0435\u043c\u0443 \u0441\u043e\u0441\u0442\u0430\u0432\u0443 \u0432\u043e\u0434\u0438\u0442\u0435\u043b\u0435\u0439."
                }
              </p>
            </div>
          </div>
        </div>

      <div className="p-5 flex-1">
          {isLoading ? (
            <div className="min-h-[320px] flex items-center justify-center text-slate-500 gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-sky-500" />
              <span className="font-semibold">
                {"\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043a\u0438..."}
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="xl:col-span-2 rounded-3xl bg-gradient-to-br from-sky-600 via-cyan-500 to-emerald-500 p-6 text-white shadow-lg shadow-sky-200">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold uppercase tracking-[0.2em] text-white/80">
                      {"\u0412\u044b\u0440\u0443\u0447\u043a\u0430 (\u041f\u043b\u0430\u043d)"}
                    </p>
                    <p className="mt-4 text-4xl sm:text-5xl font-black tracking-tight">
                      {stats.total_revenue.toLocaleString("ru-RU")} {"\u20bd"}
                    </p>
                    <p className="mt-3 text-sm text-white/85">
                      {
                        "\u0421\u0443\u043c\u043c\u0430\u0440\u043d\u0430\u044f \u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c \u0437\u0430\u043a\u0430\u0437\u043e\u0432 \u043f\u043e \u0442\u0435\u043a\u0443\u0449\u0435\u0439 \u0431\u0430\u0437\u0435 \u0431\u0435\u0437 \u0443\u0434\u0430\u043b\u0435\u043d\u043d\u044b\u0445 \u0437\u0430\u043f\u0438\u0441\u0435\u0439."
                      }
                    </p>
                  </div>
                  <div className="shrink-0 w-16 h-16 rounded-2xl bg-white/15 flex items-center justify-center">
                    <Wallet className="w-8 h-8" />
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
                <div className="w-12 h-12 rounded-2xl bg-sky-100 text-sky-600 flex items-center justify-center">
                  <ClipboardList className="w-6 h-6" />
                </div>
                <p className="mt-4 text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
                  {"\u0412\u0441\u0435\u0433\u043e \u0437\u0430\u043a\u0430\u0437\u043e\u0432"}
                </p>
                <p className="mt-2 text-4xl font-black text-slate-900">{stats.total_orders}</p>
              </div>

              <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                  <PackageCheck className="w-6 h-6" />
                </div>
                <p className="mt-4 text-sm font-bold uppercase tracking-[0.16em] text-emerald-700">
                  {"\u0423\u0441\u043f\u0435\u0448\u043d\u044b\u0445 \u0434\u043e\u0441\u0442\u0430\u0432\u043e\u043a"}
                </p>
                <p className="mt-2 text-4xl font-black text-emerald-700">{stats.completed_orders}</p>
              </div>

              <div className="md:col-span-2 xl:col-span-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
                      {"\u0411\u0430\u0437\u0430 \u0432\u043e\u0434\u0438\u0442\u0435\u043b\u0435\u0439"}
                    </p>
                    <p className="mt-2 text-4xl font-black text-slate-900">{stats.total_drivers}</p>
                    <p className="mt-3 text-sm text-slate-500">
                      {"\u041d\u0430 \u043b\u0438\u043d\u0438\u0438:"}{" "}
                      <span className="font-bold text-sky-600">{stats.active_drivers}</span>
                    </p>
                  </div>
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-700 flex items-center justify-center">
                    <Truck className="w-7 h-7" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
