import React, { useEffect, useState } from "react";
import { Crown, Edit2, ImageIcon, Plus, Star, Trash2, UploadCloud, X } from "lucide-react";
import toast from "react-hot-toast";
import { useAuthStore } from "./store";
import { baseURL, extractApiErrorMessage, resolveMediaUrl } from "./utils";
import { EquipmentListing, EquipmentTypeItem, formatEquipmentPrice, getEquipmentTariffs } from "./EquipmentCatalogScreen";
import ReasonModal from "./components/admin/ReasonModal";

interface Application {
  id: string;
  listing_title_snapshot: string;
  client_name?: string;
  contact_phone: string;
  object_address: string;
  requested_date: string;
  requested_time: string;
  duration_value: number;
  duration_unit: "hours" | "shifts";
  comment?: string;
  reject_reason?: string | null;
  cancel_reason?: string | null;
  status: "new" | "in_progress" | "closed" | "completed" | "rejected" | "cancelled";
  primary_image_url?: string;
}

type Tab = "listings" | "moderation" | "types" | "applications";
type ApplicationsTab = "active" | "history";

interface ListingTariffForm {
  type: "hour" | "shift";
  price: string;
  hours: string;
}

interface ListingForm {
  id: string;
  equipment_type: string;
  title: string;
  description: string;
  tariffs: ListingTariffForm[];
  city: string;
  district: string;
  is_active: boolean;
  is_vip: boolean;
  manual_priority: number;
  sort_order: number;
}

const emptyListing: ListingForm = {
  id: "",
  equipment_type: "",
  title: "",
  description: "",
  tariffs: [{ type: "hour", price: "", hours: "" }],
  city: "",
  district: "",
  is_active: true,
  is_vip: false,
  manual_priority: 0,
  sort_order: 0,
};

const normalizeManualPriority = (value?: number | null) => {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(100, Math.max(0, Math.trunc(parsed)));
};

const getApplicationStatusLabel = (status: Application["status"]) => {
  switch (status) {
    case "new":
      return "НОВАЯ";
    case "in_progress":
      return "В РАБОТЕ";
    case "rejected":
      return "ОТКЛОНЕНА";
    case "cancelled":
      return "ОТМЕНЕНА КЛИЕНТОМ";
    case "completed":
      return "ЗАВЕРШЕНА";
    default:
      return "ЗАКРЫТА";
  }
};

const getApplicationStatusClass = (status: Application["status"]) =>
  status === "rejected" || status === "cancelled"
    ? "text-rose-600"
    : "text-sky-600";

export default function AdminEquipmentScreen({
  applicationsOnly = false,
  onApplicationsChanged,
  onPendingModerationChanged,
}: {
  applicationsOnly?: boolean;
  onApplicationsChanged?: (applications: Application[]) => void;
  onPendingModerationChanged?: (count: number) => void;
}) {
  const { token, role } = useAuthStore();
  const [tab, setTab] = useState<Tab>(applicationsOnly ? "applications" : "listings");
  const [applicationsTab, setApplicationsTab] = useState<ApplicationsTab>("active");
  const [types, setTypes] = useState<EquipmentTypeItem[]>([]);
  const [listings, setListings] = useState<EquipmentListing[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [showListingForm, setShowListingForm] = useState(false);
  const [listingForm, setListingForm] = useState<ListingForm>({ ...emptyListing });
  const [newTypeName, setNewTypeName] = useState("");
  const [rejectingListing, setRejectingListing] = useState<EquipmentListing | null>(null);
  const [listingRejectReason, setListingRejectReason] = useState("");
  const [isRejectingListing, setIsRejectingListing] = useState(false);
  const [rejectingApplication, setRejectingApplication] = useState<Application | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const headers = { Authorization: `Bearer ${token}` };
  const activeTypes = types.filter((item) => item.is_active);
  const canManageTypes = role === "admin";
  const pendingListings = listings.filter(
    (item) => item.moderation_status === "pending_moderation",
  );
  const activeApplications = applications.filter((item) => item.status === "new" || item.status === "in_progress");
  const historyApplications = applications.filter((item) => item.status === "completed" || item.status === "rejected" || item.status === "cancelled");
  const visibleApplications = applicationsTab === "active" ? activeApplications : historyApplications;

  const load = async () => {
    setLoading(true);
    try {
      const requests: Promise<Response>[] = [
        fetch(
          canManageTypes ? `${baseURL}/admin/equipment-types` : `${baseURL}/equipment/types`,
          { headers },
        ),
        fetch(`${baseURL}/admin/equipment-applications`, { headers }),
      ];

      if (!applicationsOnly) {
        requests.push(fetch(`${baseURL}/admin/equipment`, { headers }));
      }

      const responses = await Promise.all(requests);
      if (responses.some((response) => !response.ok)) {
        throw new Error("load");
      }

      setTypes(await responses[0].json());
      const loadedApplications: Application[] = await responses[1].json();
      setApplications(loadedApplications);
      onApplicationsChanged?.(loadedApplications);
      if (responses[2]) {
        const loadedListings: EquipmentListing[] = await responses[2].json();
        setListings(loadedListings);
        onPendingModerationChanged?.(
          loadedListings.filter(
            (item) => item.moderation_status === "pending_moderation",
          ).length,
        );
      }
    } catch {
      toast.error("Не удалось загрузить раздел спецтехники");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [applicationsOnly, token]);

  const saveType = async () => {
    if (!newTypeName.trim()) return;

    const response = await fetch(`${baseURL}/admin/equipment-types`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newTypeName,
        is_active: true,
        sort_order: types.length * 10 + 10,
      }),
    });

    if (!response.ok) {
      toast.error("Не удалось создать тип");
      return;
    }

    setNewTypeName("");
    await load();
  };

  const updateType = async (item: EquipmentTypeItem, patch: Partial<EquipmentTypeItem>) => {
    const response = await fetch(`${baseURL}/admin/equipment-types/${item.id}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });

    if (!response.ok) {
      toast.error("Не удалось обновить тип");
      return;
    }

    await load();
  };

  const deleteType = async (id: string) => {
    if (!window.confirm("Удалить тип спецтехники?")) return;

    const response = await fetch(`${baseURL}/admin/equipment-types/${id}`, {
      method: "DELETE",
      headers,
    });

    if (!response.ok) {
      toast.error("Не удалось удалить тип");
      return;
    }

    await load();
  };

  const openListing = (item?: EquipmentListing) => {
    setListingForm(
      item
        ? {
            id: item.id,
            equipment_type: item.equipment_type || item.equipment_type_name,
            title: item.title,
            description: item.description,
            tariffs: getEquipmentTariffs(item).map((tariff) => ({
              type: tariff.type,
              price: tariff.price?.toString() || "",
              hours: tariff.hours?.toString() || "",
            })),
             city: item.city || "",
             district: item.district || "",
             is_active: item.is_active !== false,
             is_vip: Boolean(item.is_vip),
             manual_priority: normalizeManualPriority(item.manual_priority),
             sort_order: item.sort_order || 0,
           }
        : {
            ...emptyListing,
            equipment_type: activeTypes[0]?.name || "",
            tariffs: emptyListing.tariffs.map((tariff) => ({ ...tariff })),
          },
    );
    setShowListingForm(true);
  };

  const moderateListing = async (
    item: EquipmentListing,
    decision: "approve" | "reject",
    reason?: string,
  ) => {
    const response = await fetch(
      `${baseURL}/admin/equipment/${item.id}/${decision}`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(
          decision === "reject" ? { reason: reason?.trim() || "" } : {},
        ),
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      toast.error(
        extractApiErrorMessage(data, "Не удалось изменить статус объявления"),
      );
      return false;
    }
    toast.success(decision === "approve" ? "Объявление одобрено" : "Объявление отклонено");
    await load();
    return true;
  };

  const openRejectListingModal = (item: EquipmentListing) => {
    setRejectingListing(item);
    setListingRejectReason("");
  };

  const submitListingRejection = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!rejectingListing || !listingRejectReason.trim()) return;
    setIsRejectingListing(true);
    try {
      const success = await moderateListing(
        rejectingListing,
        "reject",
        listingRejectReason,
      );
      if (!success) return;
      setRejectingListing(null);
      setListingRejectReason("");
    } finally {
      setIsRejectingListing(false);
    }
  };

  const updateTariff = (index: number, patch: Partial<ListingTariffForm>) => {
    setListingForm((previous) => ({
      ...previous,
      tariffs: previous.tariffs.map((tariff, tariffIndex) =>
        tariffIndex === index ? { ...tariff, ...patch } : tariff,
      ),
    }));
  };

  const addShiftTariff = () => {
    if (listingForm.tariffs.some((tariff) => tariff.type === "shift")) return;

    setListingForm((previous) => ({
      ...previous,
      tariffs: [...previous.tariffs, { type: "shift", price: "", hours: "8" }],
    }));
  };

  const removeTariff = (index: number) => {
    if (listingForm.tariffs.length <= 1) return;

    setListingForm((previous) => ({
      ...previous,
      tariffs: previous.tariffs.filter((_, tariffIndex) => tariffIndex !== index),
    }));
  };

  const saveListing = async (event: React.FormEvent) => {
    event.preventDefault();

    const hourlyPrice = Number(
      listingForm.tariffs.find((tariff) => tariff.type === "hour")?.price,
    );
    const manualPriority = normalizeManualPriority(listingForm.manual_priority);

    const response = await fetch(
      `${baseURL}/admin/equipment${listingForm.id ? `/${listingForm.id}` : ""}`,
      {
        method: listingForm.id ? "PATCH" : "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...listingForm,
          id: undefined,
          manual_priority: manualPriority,
          tariffs: listingForm.tariffs.map((tariff) => ({
            type: tariff.type,
            price:
              tariff.type === "hour"
                ? Number(tariff.price)
                : hourlyPrice * Number(tariff.hours),
            hours: tariff.type === "shift" ? Number(tariff.hours) : null,
          })),
        }),
      },
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      toast.error(extractApiErrorMessage(data, "Не удалось сохранить объявление"));
      return;
    }

    setShowListingForm(false);
    await load();
    toast.success("Объявление сохранено");
  };

  const deleteListing = async (id: string) => {
    if (!window.confirm("Удалить объявление спецтехники?")) return;

    const response = await fetch(`${baseURL}/admin/equipment/${id}`, {
      method: "DELETE",
      headers,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      toast.error(extractApiErrorMessage(data, "Не удалось удалить объявление"));
      return;
    }

    await load();
  };

  const uploadPhoto = async (listingId: string, file: File) => {
    try {
      const listing = listings.find((item) => item.id === listingId);
      const isPrimary = !listing?.media_files?.length;

      const presignResponse = await fetch(`${baseURL}/media/presign-upload`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: "equipment_listing",
          entity_id: listingId,
          file_name: file.name,
          content_type: file.type,
          file_size: file.size,
          is_primary: isPrimary,
        }),
      });
      const presign = await presignResponse.json();
      if (!presignResponse.ok) {
        throw new Error(extractApiErrorMessage(presign, "Не удалось подготовить загрузку"));
      }

      const uploadResponse = await fetch(presign.upload_url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadResponse.ok) {
        throw new Error("Не удалось загрузить фотографию");
      }

      const confirmResponse = await fetch(`${baseURL}/media/confirm`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: "equipment_listing",
          entity_id: listingId,
          object_key: presign.object_key,
          file_name: file.name,
          content_type: file.type,
          file_size: file.size,
          is_primary: isPrimary,
        }),
      });
      if (!confirmResponse.ok) {
        throw new Error("Не удалось подтвердить фотографию");
      }

      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка загрузки");
    }
  };

  const mediaAction = async (mediaId: string, action: "primary" | "delete") => {
    const response = await fetch(
      `${baseURL}/media/${mediaId}${action === "primary" ? "/make-primary" : ""}`,
      {
        method: action === "primary" ? "POST" : "DELETE",
        headers,
      },
    );

    if (!response.ok) {
      toast.error("Не удалось изменить фотографию");
      return;
    }

    await load();
  };

  const changeApplicationStatus = async (item: Application) => {
    const nextStatus = item.status === "new" ? "in_progress" : "completed";
    const response = await fetch(`${baseURL}/admin/equipment-applications/${item.id}/status`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });

    if (!response.ok) {
      toast.error("Не удалось обновить заявку");
      return;
    }

    await load();
  };

  const rejectApplication = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!rejectingApplication || !rejectReason.trim()) return;

    setRejecting(true);
    try {
      const response = await fetch(
        `${baseURL}/admin/equipment-applications/${rejectingApplication.id}/reject`,
        {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ reject_reason: rejectReason }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data, "Не удалось отклонить заявку"));
      }

      setRejectingApplication(null);
      setRejectReason("");
      await load();
      toast.success("Заявка отклонена");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отклонить заявку");
    } finally {
      setRejecting(false);
    }
  };

  if (loading) {
    return <p className="py-16 text-center text-slate-400">Загрузка...</p>;
  }

  return (
    <div className="space-y-5">
      {!applicationsOnly && (
        <div className="flex gap-2 overflow-x-auto rounded-2xl bg-white p-2 shadow-sm">
          {[
            ["listings", "Объявления"],
            ["moderation", `На модерации${pendingListings.length ? ` · ${pendingListings.length}` : ""}`],
            ...(canManageTypes ? [["types", "Типы техники"]] : []),
            ["applications", "Заявки"],
          ].map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value as Tab)}
              className={`shrink-0 rounded-xl px-5 py-3 text-sm font-bold ${
                tab === value ? "bg-sky-500 text-white" : "text-slate-500"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === "types" && canManageTypes && (
        <div className="rounded-3xl bg-white p-5 shadow-sm">
          <h2 className="text-xl font-black">Типы спецтехники</h2>
          <div className="mt-4 flex gap-2">
            <input
              value={newTypeName}
              onChange={(event) => setNewTypeName(event.target.value)}
              placeholder="Новый тип"
              className="flex-1 rounded-xl bg-slate-100 p-3"
            />
            <button
              onClick={() => void saveType()}
              className="rounded-xl bg-sky-500 p-3 text-white"
            >
              <Plus />
            </button>
          </div>
          <div className="mt-4 divide-y">
            {types.map((item) => (
              <div key={item.id} className="flex items-center gap-3 py-3">
                <input
                  defaultValue={item.name}
                  onBlur={(event) => {
                    if (event.target.value.trim() && event.target.value !== item.name) {
                      void updateType(item, { name: event.target.value });
                    }
                  }}
                  className="min-w-0 flex-1 bg-transparent font-bold"
                />
                <button
                  onClick={() => void updateType(item, { is_active: !item.is_active })}
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    item.is_active
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {item.is_active ? "Активен" : "Скрыт"}
                </button>
                <button
                  onClick={() => void deleteType(item.id)}
                  className="p-2 text-rose-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "moderation" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-2xl font-black">Объявления на модерации</h2>
            <p className="text-sm text-slate-500">
              Проверка объявлений, созданных поставщиками
            </p>
          </div>
          {pendingListings.length === 0 ? (
            <p className="rounded-2xl bg-white p-10 text-center text-slate-500 shadow-sm">
              Новых объявлений на модерации нет
            </p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {pendingListings.map((item) => (
                <article
                  key={item.id}
                  className={`overflow-hidden rounded-3xl bg-white shadow-sm ${
                    item.is_vip ? "border border-amber-300 shadow-amber-100/70" : ""
                  }`}
                >
                  {item.primary_image_url ? (
                    <img
                      src={resolveMediaUrl(item.primary_image_url) || "/placeholder.jpg"}
                      className="h-52 w-full bg-slate-100 object-contain"
                      alt={item.title}
                    />
                  ) : (
                    <div className="flex h-40 items-center justify-center bg-slate-100">
                      <ImageIcon className="h-10 w-10 text-slate-300" />
                    </div>
                  )}
                  <div className="space-y-3 p-5">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-amber-600">
                        На модерации
                      </p>
                      <h3 className="text-xl font-black text-slate-900">{item.title}</h3>
                      <p className="font-bold text-sky-600">{item.equipment_type_name}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.is_vip ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-black uppercase tracking-wide text-amber-800">
                            <Crown className="h-3.5 w-3.5" />
                            VIP
                          </span>
                        ) : null}
                        {item.manual_priority ? (
                          <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                            Приоритет: {item.manual_priority}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <p className="text-sm text-slate-600">{item.description}</p>
                    <div className="rounded-xl bg-slate-50 p-3 text-sm">
                      <p className="font-bold">{item.owner_name || "Поставщик"}</p>
                      {item.owner_phone ? <p className="text-slate-500">{item.owner_phone}</p> : null}
                      <p className="mt-1">{formatEquipmentPrice(item)}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => openRejectListingModal(item)}
                        className="flex-1 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 font-bold text-rose-700"
                      >
                        Отклонить
                      </button>
                      <button
                        type="button"
                        onClick={() => void moderateListing(item, "approve")}
                        className="flex-1 rounded-xl bg-emerald-500 px-4 py-3 font-bold text-white shadow-sm"
                      >
                        Одобрить
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "listings" && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-black">Объявления спецтехники</h2>
              <p className="text-sm text-slate-500">Публикации клиентского каталога</p>
            </div>
            <button
              onClick={() => openListing()}
              className="flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-3 font-bold text-white"
            >
              <Plus className="h-4 w-4" />
              Добавить
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {listings.map((item) => (
              <div key={item.id} className="overflow-hidden rounded-3xl bg-white shadow-sm">
                <div className="relative bg-slate-100">
                  {item.primary_image_url ? (
                    <img
                      src={resolveMediaUrl(item.primary_image_url) || "/placeholder.jpg"}
                      className="h-48 w-full object-contain"
                      alt={item.title}
                    />
                  ) : (
                    <div className="flex h-48 items-center justify-center bg-slate-100">
                      <ImageIcon className="h-10 w-10 text-slate-300" />
                    </div>
                  )}
                  <label className="absolute bottom-3 right-3 cursor-pointer rounded-xl bg-white p-2 shadow">
                    <UploadCloud className="h-5 w-5 text-sky-500" />
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          void uploadPhoto(item.id, file);
                        }
                        event.target.value = "";
                      }}
                    />
                  </label>
                </div>

                <div className="p-4">
                  <p className="text-xs font-bold text-sky-600">{item.equipment_type_name}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.is_vip ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-black uppercase tracking-wide text-amber-800">
                        <Crown className="h-3.5 w-3.5" />
                        VIP
                      </span>
                    ) : null}
                    {item.manual_priority ? (
                      <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                        Приоритет: {item.manual_priority}
                      </span>
                    ) : null}
                  </div>
                  <span
                    className={`mt-1 inline-flex rounded-full px-2 py-1 text-[10px] font-black uppercase ${
                      item.moderation_status === "approved"
                        ? "bg-emerald-100 text-emerald-700"
                        : item.moderation_status === "rejected"
                          ? "bg-rose-100 text-rose-700"
                          : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {item.moderation_status === "approved"
                      ? "Одобрено"
                      : item.moderation_status === "rejected"
                        ? "Отклонено"
                        : "На модерации"}
                  </span>
                  <div className="flex justify-between gap-2">
                    <div>
                      <h3 className="text-lg font-black">{item.title}</h3>
                      <p className="font-bold">{formatEquipmentPrice(item)}</p>
                    </div>
                    <div className="flex">
                      <button onClick={() => openListing(item)} className="p-2 text-slate-500">
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => void deleteListing(item.id)}
                        className="p-2 text-rose-500"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex gap-2 overflow-x-auto">
                    {item.media_files?.map((media) => (
                      <div key={media.id} className="relative shrink-0">
                        <img
                          src={resolveMediaUrl(media.public_url) || "/placeholder.jpg"}
                          className="h-16 w-20 rounded-lg bg-slate-100 object-contain"
                          alt={item.title}
                        />
                        <button
                          onClick={() => void mediaAction(media.id, "primary")}
                          className={`absolute left-1 top-1 rounded-full p-1 ${
                            media.is_primary
                              ? "bg-amber-400 text-white"
                              : "bg-white/90 text-slate-500"
                          }`}
                        >
                          <Star className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => void mediaAction(media.id, "delete")}
                          className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-rose-500"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "applications" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-2xl font-black">Заявки на спецтехнику</h2>
            <p className="text-sm text-slate-500">Обработка клиентских заявок</p>
          </div>

          <div className="flex gap-2 overflow-x-auto rounded-2xl bg-white p-2 shadow-sm">
            {[
              ["active", "Активные"],
              ["history", "История"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setApplicationsTab(value as ApplicationsTab)}
                className={`shrink-0 rounded-xl px-5 py-3 text-sm font-bold ${
                  applicationsTab === value ? "bg-sky-500 text-white" : "text-slate-500"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {visibleApplications.length === 0 ? (
            <p className="rounded-2xl bg-white p-10 text-center text-slate-500">
              {applicationsTab === "active" ? "Активных заявок пока нет" : "История заявок пуста"}
            </p>
          ) : (
            visibleApplications.map((item) => (
              <div key={item.id} className="rounded-3xl bg-white p-5 shadow-sm">
                <div className="flex gap-4">
                  {item.primary_image_url && (
                    <img
                      src={resolveMediaUrl(item.primary_image_url) || "/placeholder.jpg"}
                      className="h-24 w-28 rounded-xl bg-slate-100 object-contain"
                      alt={item.listing_title_snapshot}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className={`text-xs font-bold ${getApplicationStatusClass(item.status)}`}>
                          {getApplicationStatusLabel(item.status)}
                        </p>
                        <h3 className="text-lg font-black">{item.listing_title_snapshot}</h3>
                      </div>
                    </div>
                    <p className="mt-1 text-sm font-bold">{item.client_name} · {item.contact_phone}</p>
                    <p className="mt-2 text-sm text-slate-600">{item.object_address}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {new Date(item.requested_date).toLocaleDateString("ru-RU")} в{" "}
                      {item.requested_time.slice(0, 5)} · {item.duration_value}{" "}
                      {item.duration_unit === "hours" ? "ч." : "смен"}
                    </p>
                  </div>
                </div>

                {item.comment && (
                  <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">{item.comment}</p>
                )}
                {item.reject_reason && (
                  <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
                    <span className="font-bold">Причина отказа:</span> {item.reject_reason}
                  </p>
                )}
                {item.cancel_reason && (
                  <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
                    <span className="font-bold">Причина отмены:</span> {item.cancel_reason}
                  </p>
                )}

                {(item.status === "new" || item.status === "in_progress") && (
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => void changeApplicationStatus(item)}
                      className={`flex-1 rounded-xl p-3 font-bold ${
                        item.status === "new"
                          ? "bg-sky-500 text-white"
                          : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {item.status === "new" ? "Взять в работу" : "Завершить заявку"}
                    </button>
                    <button
                      onClick={() => {
                        setRejectingApplication(item);
                        setRejectReason("");
                      }}
                      className="flex-1 rounded-xl bg-rose-600 p-3 font-bold text-white"
                    >
                      Отказаться
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {showListingForm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={saveListing}
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6"
          >
            <div className="mb-5 flex justify-between">
              <h3 className="text-xl font-black">
                {listingForm.id ? "Редактировать" : "Новое объявление"}
              </h3>
              <button type="button" onClick={() => setShowListingForm(false)}>
                <X />
              </button>
            </div>

            <div className="space-y-4">
              <label className="block text-sm font-bold">
                Тип
                <input
                  required
                  list="admin-equipment-types"
                  value={listingForm.equipment_type}
                  onChange={(event) =>
                    setListingForm({ ...listingForm, equipment_type: event.target.value })
                  }
                  className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal"
                  placeholder="Например, Автокран"
                />
                <datalist id="admin-equipment-types">
                  {activeTypes.map((item) => (
                    <option key={item.id} value={item.name} />
                  ))}
                </datalist>
              </label>

              <label className="block text-sm font-bold">
                Название
                <input
                  required
                  value={listingForm.title}
                  onChange={(event) =>
                    setListingForm({ ...listingForm, title: event.target.value })
                  }
                  className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal"
                />
              </label>

              <label className="block text-sm font-bold">
                Описание
                <textarea
                  required
                  rows={5}
                  value={listingForm.description}
                  onChange={(event) =>
                    setListingForm({ ...listingForm, description: event.target.value })
                  }
                  className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal"
                />
              </label>

              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="font-bold">Тарифы аренды</p>
                    <p className="text-xs text-slate-500">
                      Смена рассчитывается из цены за час
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={listingForm.tariffs.some((tariff) => tariff.type === "shift")}
                    onClick={addShiftTariff}
                    className="rounded-xl bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700 disabled:opacity-40"
                  >
                    <Plus className="mr-1 inline h-3 w-3" />
                    Добавить тариф
                  </button>
                </div>

                <div className="space-y-3">
                  {listingForm.tariffs.map((tariff, index) => (
                    <div key={tariff.type} className="rounded-xl bg-slate-50 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-sm font-bold">
                          {tariff.type === "hour" ? "За час" : "Смена"}
                        </p>
                        <button
                          type="button"
                          disabled={listingForm.tariffs.length <= 1 || tariff.type === "hour"}
                          onClick={() => removeTariff(index)}
                          className="text-xs font-bold text-rose-600 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          Удалить
                        </button>
                      </div>

                      {tariff.type === "hour" ? (
                        <label className="block text-sm font-bold">
                          Цена за час
                          <input
                            required
                            type="number"
                            min="1"
                            step="0.01"
                            value={tariff.price}
                            onChange={(event) =>
                              updateTariff(index, { price: event.target.value })
                            }
                            className="mt-1 w-full rounded-xl bg-white p-3 font-normal"
                          />
                        </label>
                      ) : (
                        <div className="grid grid-cols-2 gap-3">
                          <label className="text-sm font-bold">
                            Часов в смене
                            <input
                              required
                              type="number"
                              min="1"
                              max="24"
                              step="0.5"
                              value={tariff.hours}
                              onChange={(event) =>
                                updateTariff(index, { hours: event.target.value })
                              }
                              className="mt-1 w-full rounded-xl bg-white p-3 font-normal"
                            />
                          </label>
                          <div>
                            <p className="text-sm font-bold">Цена смены</p>
                            <p className="mt-1 rounded-xl bg-white p-3 font-bold">
                              {(
                                Number(listingForm.tariffs[0].price) *
                                Number(tariff.hours || 0)
                              ).toLocaleString("ru-RU")}{" "}
                              ₽
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-bold">
                  Город
                  <input
                    value={listingForm.city}
                    onChange={(event) =>
                      setListingForm({ ...listingForm, city: event.target.value })
                    }
                    className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal"
                  />
                </label>
                <label className="text-sm font-bold">
                  Район
                  <input
                    value={listingForm.district}
                    onChange={(event) =>
                      setListingForm({ ...listingForm, district: event.target.value })
                    }
                    className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 gap-3 rounded-2xl border border-amber-100 bg-amber-50/60 p-4 sm:grid-cols-2">
                <label className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 text-sm font-bold text-slate-800">
                  <input
                    type="checkbox"
                    checked={listingForm.is_vip}
                    onChange={(event) =>
                      setListingForm({ ...listingForm, is_vip: event.target.checked })
                    }
                    className="h-4 w-4 rounded border-amber-300 text-amber-500 focus:ring-amber-400"
                  />
                  VIP-статус
                </label>
                <label className="text-sm font-bold text-slate-800">
                  Ручной приоритет (0-100)
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={listingForm.manual_priority}
                    onChange={(event) =>
                      setListingForm({
                        ...listingForm,
                        manual_priority: normalizeManualPriority(Number(event.target.value)),
                      })
                    }
                    className="mt-1 w-full rounded-xl bg-white p-3 font-normal"
                  />
                </label>
              </div>

              <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                <input
                  type="checkbox"
                  checked={listingForm.is_active}
                  onChange={(event) =>
                    setListingForm({ ...listingForm, is_active: event.target.checked })
                  }
                />
                Активное объявление
              </label>
            </div>

            <button className="mt-5 w-full rounded-xl bg-sky-500 p-4 font-bold text-white">
              Сохранить
            </button>
          </form>
        </div>
      )}

      <ReasonModal
        isOpen={Boolean(rejectingListing)}
        eyebrow="Модерация объявления"
        title="Причина отклонения"
        subject={rejectingListing?.title}
        label="Укажите, что нужно исправить"
        value={listingRejectReason}
        placeholder="Например: добавьте фото техники, уточните описание или тарифы."
        submitLabel="Отклонить"
        submittingLabel="Отклоняем..."
        isSubmitting={isRejectingListing}
        submitDisabled={!listingRejectReason.trim()}
        onChange={setListingRejectReason}
        onClose={() => {
          setRejectingListing(null);
          setListingRejectReason("");
        }}
        onSubmit={submitListingRejection}
      />

      <ReasonModal
        isOpen={Boolean(rejectingApplication)}
        eyebrow="Отказ от заявки"
        title="Причина отказа"
        subject={rejectingApplication?.listing_title_snapshot}
        label="Причина отказа"
        value={rejectReason}
        submitLabel="Отклонить"
        submittingLabel="Сохраняем..."
        isSubmitting={rejecting}
        submitDisabled={!rejectReason.trim()}
        onChange={setRejectReason}
        onClose={() => setRejectingApplication(null)}
        onSubmit={rejectApplication}
      />
    </div>
  );
}
