import { type FormEvent, useEffect, useState } from "react";
import { Building2, Loader2, MapPin, Pencil, Phone, X } from "lucide-react";
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
  const [editingSupplier, setEditingSupplier] = useState<AdminSupplier | null>(null);
  const [editForm, setEditForm] = useState({
    full_name: "",
    phone: "",
    is_active: true,
  });
  const [isSaving, setIsSaving] = useState(false);

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

  const openEdit = (supplier: AdminSupplier) => {
    setEditingSupplier(supplier);
    setEditForm({
      full_name: supplier.full_name || "",
      phone: supplier.phone,
      is_active: supplier.is_active,
    });
  };

  const updateSupplierRequest = async () => {
    if (!editingSupplier) {
      throw new Error("Поставщик не выбран");
    }

    const urls = [
      `${baseURL}/admin/suppliers/${editingSupplier.id}`,
      `${baseURL}/admin/suppliers/${editingSupplier.id}/`,
    ];
    let lastPayload: unknown = {};

    for (const url of urls) {
      const response = await fetch(url, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(editForm),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        return data;
      }
      if (response.status !== 404) {
        throw new Error(
          extractApiErrorMessage(data, "Не удалось обновить поставщика"),
        );
      }
      lastPayload = data;
    }

    throw new Error(
      extractApiErrorMessage(
        lastPayload,
        "На сервере не подключён маршрут редактирования поставщиков. Требуется обновление backend.",
      ),
    );
  };

  const saveSupplier = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingSupplier) return;
    setIsSaving(true);
    try {
      const updatedSupplier = await updateSupplierRequest();
      setSuppliers((current) =>
        current.map((supplier) =>
          supplier.id === editingSupplier.id ? updatedSupplier : supplier,
        ),
      );
      setEditingSupplier(null);
      toast.success("Данные поставщика обновлены");
      return;
      const response = await fetch(
        `${baseURL}/admin/suppliers/${editingSupplier.id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(editForm),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          extractApiErrorMessage(data, "Не удалось обновить поставщика"),
        );
      }
      setSuppliers((current) =>
        current.map((supplier) =>
          supplier.id === editingSupplier.id ? data : supplier,
        ),
      );
      setEditingSupplier(null);
      toast.success("Данные поставщика обновлены");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка сохранения");
    } finally {
      setIsSaving(false);
    }
  };

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
                  <th className="px-5 py-4">Статус</th>
                  <th className="px-5 py-4">Активные точки</th>
                  <th className="px-5 py-4 text-right">Действия</th>
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
                    <td className="px-5 py-4">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold ${
                          supplier.is_active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {supplier.is_active ? "Активен" : "Отключён"}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {supplier.active_point_names.length > 0
                        ? supplier.active_point_names.join(", ")
                        : "Нет активных точек"}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(supplier)}
                        className="rounded-xl bg-sky-50 p-2 text-sky-600 hover:bg-sky-100"
                        aria-label="Редактировать поставщика"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
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
                    <div className="mt-3 flex items-center justify-between">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold ${
                          supplier.is_active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {supplier.is_active ? "Активен" : "Отключён"}
                      </span>
                      <button
                        type="button"
                        onClick={() => openEdit(supplier)}
                        className="flex items-center gap-2 rounded-xl bg-sky-50 px-3 py-2 text-sm font-bold text-sky-600"
                      >
                        <Pencil className="h-4 w-4" />
                        Изменить
                      </button>
                    </div>
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

      {editingSupplier ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={saveSupplier}
            className="w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-black text-slate-900">
                Редактировать поставщика
              </h3>
              <button type="button" onClick={() => setEditingSupplier(null)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <label className="block text-sm font-bold text-slate-700">
              ФИО / Название
              <input
                value={editForm.full_name}
                onChange={(event) =>
                  setEditForm({ ...editForm, full_name: event.target.value })
                }
                className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal"
              />
            </label>
            <label className="block text-sm font-bold text-slate-700">
              Телефон
              <input
                required
                value={editForm.phone}
                onChange={(event) =>
                  setEditForm({ ...editForm, phone: event.target.value })
                }
                className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal"
              />
            </label>
            <label className="flex items-center justify-between rounded-xl bg-slate-50 p-4 font-bold text-slate-700">
              Аккаунт активен
              <input
                type="checkbox"
                checked={editForm.is_active}
                onChange={(event) =>
                  setEditForm({ ...editForm, is_active: event.target.checked })
                }
                className="h-5 w-5 accent-sky-500"
              />
            </label>
            <button
              type="submit"
              disabled={isSaving}
              className="w-full rounded-xl bg-sky-500 p-3 font-bold text-white disabled:opacity-50"
            >
              {isSaving ? "Сохранение..." : "Сохранить"}
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
