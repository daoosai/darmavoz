import { useEffect, useState } from "react";
import { Building2, Loader2, MapPin, Phone } from "lucide-react";
import toast from "react-hot-toast";

import { useAuthStore } from "./store";
import { baseURL, extractApiErrorMessage, formatPhoneNumber } from "./utils";

interface AdminSupplier {
  id: string;
  full_name?: string | null;
  phone: string;
  is_active: boolean;
  active_point_names: string[];
}

export default function AdminSuppliersScreen() {
  const token = useAuthStore((state) => state.token);
  const [suppliers, setSuppliers] = useState<AdminSupplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchSuppliers = async () => {
      try {
        const response = await fetch(`${baseURL}/admin/suppliers`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await response.json().catch(() => []);
        if (!response.ok) {
          throw new Error(
            extractApiErrorMessage(data, "Не удалось загрузить список поставщиков"),
          );
        }
        setSuppliers(Array.isArray(data) ? data : []);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Не удалось загрузить список поставщиков",
        );
      } finally {
        setIsLoading(false);
      }
    };

    void fetchSuppliers();
  }, [token]);

  return (
    <section className="flex flex-col gap-5">
      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-500">
          Поставщики
        </p>
        <h2 className="mt-2 text-2xl font-black text-slate-900">
          Список поставщиков
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          Телефоны и активные точки забора поставщиков.
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-slate-100 bg-white p-10 shadow-sm">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-sky-500" />
        </div>
      ) : suppliers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center shadow-sm">
          <Building2 className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-4 text-lg font-bold text-slate-700">
            Поставщиков пока нет
          </p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm md:block">
            <table className="min-w-full text-left">
              <thead className="bg-slate-50 text-sm font-bold text-slate-500">
                <tr>
                  <th className="px-5 py-4">ФИО</th>
                  <th className="px-5 py-4">Телефон</th>
                  <th className="px-5 py-4">Активные точки</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr key={supplier.id} className="border-t border-slate-100 align-top">
                    <td className="px-5 py-4 font-bold text-slate-900">
                      {supplier.full_name?.trim() || "Не указано"}
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {formatPhoneNumber(supplier.phone)}
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {supplier.active_point_names.length > 0
                        ? supplier.active_point_names.join(", ")
                        : "Нет активных точек"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {suppliers.map((supplier) => (
              <article
                key={supplier.id}
                className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-sky-50 p-3 text-sky-600">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-900">
                      {supplier.full_name?.trim() || "Не указано"}
                    </p>
                    <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                      <Phone className="h-4 w-4" />
                      {formatPhoneNumber(supplier.phone)}
                    </p>
                    <p className="mt-2 flex items-start gap-2 text-sm text-slate-500">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        {supplier.active_point_names.length > 0
                          ? supplier.active_point_names.join(", ")
                          : "Нет активных точек"}
                      </span>
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
