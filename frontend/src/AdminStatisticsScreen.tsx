import OperatorCityBar from './OperatorCityBar';
import { operatorFetch, useOperatorCityStore } from './operatorCityStore';
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
      ? "Статистика логиста"
      : "Статистика администратора";
  const cityId = useOperatorCityStore((state) => state.cityId);
  const token = useAuthStore((state) => state.token);
  const [stats, setStats] = useState<AdminStatistics>(initialStats);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchStatistics = async () => {
      try {
        setIsLoading(true);
        const res = await operatorFetch(`${baseURL}/admin/statistics`, {
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
      if (error?.name === "AbortError") return;
        toast.error(
          handleApiError(
            error,
            "Не удалось загрузить статистику",
          ),
        );
      } finally {
        setIsLoading(false);
      }
    };

    fetchStatistics();
  }, [token, cityId]);

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
          <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-start gap-3 sm:gap-4">
              <div className="w-12 h-12 rounded-2xl bg-sky-100 text-sky-600 flex items-center justify-center shrink-0">
                <BarChart3 className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-slate-900">
                  {title}
                </h1>
                <p className="text-sm text-slate-500 max-w-2xl">
                  {
                    "Операционная сводка по заказам, выручке и текущему составу водителей."
                  }
                </p>
              </div>
            </div>
          </div>
        </div>

        <OperatorCityBar />
        <div className="flex-1 px-4 sm:px-6 lg:px-8 py-5 sm:py-6">
          {isLoading ? (
            <div className="min-h-[320px] flex items-center justify-center text-slate-500 gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-sky-500" />
              <span className="font-semibold">
                {"Загрузка статистики..."}
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-4 lg:gap-5">
              <div className="md:col-span-2 xl:col-span-6 rounded-3xl bg-gradient-to-br from-sky-600 via-cyan-500 to-emerald-500 p-6 lg:p-7 text-white shadow-lg shadow-sky-200">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold uppercase tracking-[0.2em] text-white/80">
                      {"Выручка (План)"}
                    </p>
                    <p className="mt-4 text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight">
                      {stats.total_revenue.toLocaleString("ru-RU")} {"₽"}
                    </p>
                    <p className="mt-3 text-sm text-white/85 max-w-xl">
                      {
                        "Суммарная стоимость заказов по текущей базе без удаленных записей."
                      }
                    </p>
                  </div>
                  <div className="shrink-0 w-16 h-16 lg:w-20 lg:h-20 rounded-3xl bg-white/15 flex items-center justify-center">
                    <Wallet className="w-8 h-8 lg:w-10 lg:h-10" />
                  </div>
                </div>
              </div>

              <div className="xl:col-span-3 rounded-3xl border border-slate-200 bg-slate-50 p-5 lg:p-6 shadow-sm">
                <div className="w-12 h-12 rounded-2xl bg-sky-100 text-sky-600 flex items-center justify-center">
                  <ClipboardList className="w-6 h-6" />
                </div>
                <p className="mt-4 text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
                  {"Всего заказов"}
                </p>
                <p className="mt-2 text-4xl lg:text-5xl font-black text-slate-900">
                  {stats.total_orders}
                </p>
              </div>

              <div className="xl:col-span-3 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 lg:p-6 shadow-sm">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                  <PackageCheck className="w-6 h-6" />
                </div>
                <p className="mt-4 text-sm font-bold uppercase tracking-[0.16em] text-emerald-700">
                  {"Успешных доставок"}
                </p>
                <p className="mt-2 text-4xl lg:text-5xl font-black text-emerald-700">
                  {stats.completed_orders}
                </p>
              </div>

              <div className="md:col-span-2 xl:col-span-12 rounded-3xl border border-slate-200 bg-white p-5 lg:p-6 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
                      {"База водителей"}
                    </p>
                    <p className="mt-2 text-4xl lg:text-5xl font-black text-slate-900">
                      {stats.total_drivers}
                    </p>
                    <p className="mt-3 text-sm lg:text-base text-slate-500">
                      {"На линии:"}{" "}
                      <span className="font-bold text-sky-600">
                        {stats.active_drivers}
                      </span>
                    </p>
                  </div>
                  <div className="w-14 h-14 lg:w-16 lg:h-16 rounded-2xl bg-slate-100 text-slate-700 flex items-center justify-center">
                    <Truck className="w-7 h-7 lg:w-8 lg:h-8" />
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
