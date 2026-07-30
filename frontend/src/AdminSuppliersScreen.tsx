import { type FormEvent, useEffect, useState } from "react";
import {
  Building2,
  Loader2,
  MapPin,
  Pencil,
  Phone,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import { useAuthStore } from "./store";
import { baseURL, extractApiErrorMessage, formatPhoneNumber } from "./utils";

type PartnerTab = "supplier" | "equipment_owner";

interface AdminPartner {
  id: string;
  role: PartnerTab;
  full_name?: string | null;
  phone: string;
  is_active: boolean;
  active_point_names: string[];
  active_equipment_names: string[];
}

interface AdminPartnerResponse {
  id?: string;
  role?: string;
  full_name?: string | null;
  phone?: string | null;
  is_active?: boolean;
  active_point_names?: unknown;
  active_equipment_names?: unknown;
}

const TAB_META: Record<
  PartnerTab,
  {
    title: string;
    subtitle: string;
    emptyTitle: string;
    emptyDescription: string;
    actionLabel: string;
    icon: typeof Building2;
  }
> = {
  supplier: {
    title: "Поставщики",
    subtitle: "Телефоны и активные точки поставщиков карьеров и накопителей.",
    emptyTitle: "Поставщики не найдены",
    emptyDescription: "Нет активных точек",
    actionLabel: "Активные точки",
    icon: Building2,
  },
  equipment_owner: {
    title: "Партнеры",
    subtitle: "ФИО, телефоны и список активной спецтехники партнеров.",
    emptyTitle: "Партнеры не найдены",
    emptyDescription: "Нет активной спецтехники",
    actionLabel: "Активная спецтехника",
    icon: Wrench,
  },
};

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const normalizePartner = (item: AdminPartnerResponse, activeTab: PartnerTab): AdminPartner | null => {
  if (!item?.id || !item?.phone) {
    return null;
  }

  return {
    id: item.id,
    role: activeTab,
    full_name: item.full_name || null,
    phone: item.phone,
    is_active: Boolean(item.is_active),
    active_point_names: toStringArray(item.active_point_names),
    active_equipment_names: toStringArray(item.active_equipment_names),
  };
};

const getPartnerItems = (partner: AdminPartner, tab: PartnerTab) =>
  tab === "supplier" ? partner.active_point_names : partner.active_equipment_names;

export default function AdminSuppliersScreen() {
  const token = useAuthStore((state) => state.token);
  const [activeTab, setActiveTab] = useState<PartnerTab>("supplier");
  const [partners, setPartners] = useState<AdminPartner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingPartner, setEditingPartner] = useState<AdminPartner | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    full_name: "",
    phone: "",
    is_active: true,
  });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchPartners = async () => {
      try {
        setIsLoading(true);
        const response = await fetch(`${baseURL}/admin/suppliers?role=${activeTab}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await response.json().catch(() => []);
        if (!response.ok) {
          throw new Error(
            extractApiErrorMessage(data, "Не удалось загрузить список партнеров"),
          );
        }
        const normalized = Array.isArray(data)
          ? data
              .map((item) => normalizePartner(item as AdminPartnerResponse, activeTab))
              .filter((item): item is AdminPartner => item !== null)
          : [];
        setPartners(normalized);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Не удалось загрузить список партнеров",
        );
        setPartners([]);
      } finally {
        setIsLoading(false);
      }
    };

    void fetchPartners();
  }, [activeTab, token]);

  const openEdit = (partner: AdminPartner) => {
    setEditingPartner(partner);
    setEditForm({
      full_name: partner.full_name || "",
      phone: partner.phone,
      is_active: partner.is_active,
    });
  };

  const updatePartnerRequest = async () => {
    if (!editingPartner) {
      throw new Error("Партнер не выбран");
    }

    const urls = [
      `${baseURL}/admin/suppliers/${editingPartner.id}`,
      `${baseURL}/admin/suppliers/${editingPartner.id}/`,
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
        const normalized = normalizePartner(data as AdminPartnerResponse, editingPartner.role);
        if (!normalized) {
          throw new Error("Сервер вернул неполные данные партнера");
        }
        return normalized;
      }
      if (response.status !== 404) {
        throw new Error(
          extractApiErrorMessage(data, "Не удалось обновить партнера"),
        );
      }
      lastPayload = data;
    }

    throw new Error(
      extractApiErrorMessage(
        lastPayload,
        "На сервере не подключен маршрут редактирования партнеров. Требуется обновление backend.",
      ),
    );
  };

  const savePartner = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingPartner) return;
    setIsSaving(true);
    try {
      const updatedPartner = await updatePartnerRequest();
      setPartners((current) =>
        current.map((partner) =>
          partner.id === editingPartner.id ? updatedPartner : partner,
        ),
      );
      setEditingPartner(null);
      toast.success("Данные партнера обновлены");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка сохранения");
    } finally {
      setIsSaving(false);
    }
  };

  const deletePartner = async (partner: AdminPartner) => {
    if (!window.confirm("Удалить этого партнера?")) {
      return;
    }

    try {
      setDeletingId(partner.id);
      const response = await fetch(`${baseURL}/admin/users/${partner.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          extractApiErrorMessage(data, "Не удалось удалить партнера"),
        );
      }
      setPartners((current) => current.filter((item) => item.id !== partner.id));
      toast.success("Партнер удален");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка удаления");
    } finally {
      setDeletingId(null);
    }
  };

  const meta = TAB_META[activeTab];
  const TabIcon = meta.icon;

  return (
    <section className="flex flex-col gap-5">
      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-500">
          Поставщики / Партнеры
        </p>
        <h2 className="mt-2 text-2xl font-black text-slate-900">
          Управление B2B-пользователями
        </h2>
        <p className="mt-2 text-sm text-slate-500">{meta.subtitle}</p>

        <div className="mt-5 inline-flex rounded-2xl bg-slate-100 p-1">
          {(["supplier", "equipment_owner"] as PartnerTab[]).map((tab) => {
            const tabMeta = TAB_META[tab];
            const isActive = tab === activeTab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-xl px-4 py-2 text-sm font-bold transition-colors ${
                  isActive
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {tabMeta.title}
              </button>
            );
          })}
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-slate-100 bg-white p-10 shadow-sm">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-sky-500" />
        </div>
      ) : partners.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center shadow-sm">
          <TabIcon className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-4 text-lg font-bold text-slate-700">{meta.emptyTitle}</p>
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
                  <th className="px-5 py-4">{meta.actionLabel}</th>
                  <th className="px-5 py-4 text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {partners.map((partner) => {
                  const activeItems = getPartnerItems(partner, activeTab);
                  const isDeleting = deletingId === partner.id;
                  return (
                    <tr key={partner.id} className="border-t border-slate-100 align-top">
                      <td className="px-5 py-4 font-bold text-slate-900">
                        {partner.full_name?.trim() || "Не указано"}
                      </td>
                      <td className="px-5 py-4 text-slate-600">
                        {formatPhoneNumber(partner.phone)}
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-bold ${
                            partner.is_active
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {partner.is_active ? "Активен" : "Отключен"}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-slate-600">
                        {activeItems.length > 0
                          ? activeItems.join(", ")
                          : meta.emptyDescription}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(partner)}
                            className="rounded-xl bg-sky-50 p-2 text-sky-600 hover:bg-sky-100"
                            aria-label="Редактировать партнера"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void deletePartner(partner)}
                            disabled={isDeleting}
                            className="rounded-xl bg-rose-50 p-2 text-rose-600 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label="Удалить партнера"
                          >
                            {isDeleting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {partners.map((partner) => {
              const activeItems = getPartnerItems(partner, activeTab);
              const isDeleting = deletingId === partner.id;
              return (
                <article
                  key={partner.id}
                  className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-sky-50 p-3 text-sky-600">
                      <TabIcon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-slate-900">
                        {partner.full_name?.trim() || "Не указано"}
                      </p>
                      <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                        <Phone className="h-4 w-4" />
                        {formatPhoneNumber(partner.phone)}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-bold ${
                            partner.is_active
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {partner.is_active ? "Активен" : "Отключен"}
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(partner)}
                            className="flex items-center gap-2 rounded-xl bg-sky-50 px-3 py-2 text-sm font-bold text-sky-600"
                          >
                            <Pencil className="h-4 w-4" />
                            Изменить
                          </button>
                          <button
                            type="button"
                            onClick={() => void deletePartner(partner)}
                            disabled={isDeleting}
                            className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-600 disabled:opacity-60"
                          >
                            {isDeleting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                            Удалить
                          </button>
                        </div>
                      </div>
                      <p className="mt-3 flex items-start gap-2 text-sm text-slate-500">
                        {activeTab === "supplier" ? (
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                        ) : (
                          <Wrench className="mt-0.5 h-4 w-4 shrink-0" />
                        )}
                        <span>
                          {activeItems.length > 0
                            ? activeItems.join(", ")
                            : meta.emptyDescription}
                        </span>
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      {editingPartner ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={savePartner}
            className="w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-black text-slate-900">
                Редактировать партнера
              </h3>
              <button type="button" onClick={() => setEditingPartner(null)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <label className="block text-sm font-bold text-slate-700">
              {editingPartner.role === "equipment_owner" ? "ФИО" : "ФИО / Название"}
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
              Профиль активен
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
