import { type FormEvent, useEffect, useState } from "react";
import { AlertCircle, Edit2, ImageIcon, Loader2, Plus, Trash2, UploadCloud, X } from "lucide-react";
import toast from "react-hot-toast";

import {
  type EquipmentListing,
  type EquipmentTypeItem,
  formatEquipmentPrice,
  getEquipmentTariffs,
} from "./EquipmentCatalogScreen";
import { useAuthStore } from "./store";
import { baseURL, extractApiErrorMessage, formatPhoneNumber, resolveMediaUrl } from "./utils";
import {
  PlacementBadge,
  PlacementDates,
  PlacementExpirationWarning,
  shouldShowConfirmationAction,
} from "./placement";

interface Props {
  token: string;
  apiPrefix?: "/supplier" | "/equipment-owner";
}

interface EquipmentForm {
  id: string;
  equipment_type: string;
  title: string;
  description: string;
  contact_phone: string;
  hourly_price: string;
  shift_hours: string;
  city: string;
  district: string;
}

interface PendingPhotoItem {
  id: string;
  file: File;
  previewUrl: string;
}

const EMPTY_FORM: EquipmentForm = {
  id: "",
  equipment_type: "",
  title: "",
  description: "",
  contact_phone: "",
  hourly_price: "",
  shift_hours: "",
  city: "",
  district: "",
};

const normalizeContactPhoneForApi = (value: string) => {
  const normalized = value.replace(/[^\d+]/g, "").trim();
  return normalized || null;
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  pending_moderation: {
    label: "На модерации",
    className: "bg-amber-100 text-amber-700",
  },
  approved: {
    label: "Одобрено",
    className: "bg-emerald-100 text-emerald-700",
  },
  rejected: {
    label: "Отклонено",
    className: "bg-rose-100 text-rose-700",
  },
  suspended: {
    label: "Приостановлено",
    className: "bg-slate-200 text-slate-700",
  },
};

STATUS_META.has_pending_changes = {
  label: "Есть правки",
  className: "bg-sky-100 text-sky-800",
};

type ListingsTab = "active" | "moderation" | "archived";

const LISTING_TAB_LABELS: Record<ListingsTab, string> = {
  active: "Активные",
  moderation: "На модерации",
  archived: "Отклоненные / скрытые",
};

const matchesListingTab = (listing: EquipmentListing, tab: ListingsTab) => {
  if (tab === "active") {
    return listing.moderation_status === "approved" && listing.is_active;
  }
  if (tab === "moderation") {
    return (
      listing.moderation_status === "pending_moderation" ||
      listing.moderation_status === "has_pending_changes"
    );
  }
  return listing.moderation_status === "rejected" || !listing.is_active;
};

export default function SupplierEquipmentScreen({
  token,
  apiPrefix = "/supplier",
}: Props) {
  const { currentUser } = useAuthStore();
  const [types, setTypes] = useState<EquipmentTypeItem[]>([]);
  const [listings, setListings] = useState<EquipmentListing[]>([]);
  const [tab, setTab] = useState<ListingsTab>("active");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<EquipmentForm>(EMPTY_FORM);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhotoItem[]>([]);
  const [equipmentOwnerName, setEquipmentOwnerName] = useState(currentUser?.name?.trim() || "");
  const pendingPhotoPreviews = pendingPhotos.map((item) => item.previewUrl);
  const requiresEquipmentOwnerName = apiPrefix === "/equipment-owner";
  const isEquipmentOwnerCreationBlocked =
    requiresEquipmentOwnerName && equipmentOwnerName.trim().length === 0;

  const headers = { Authorization: `Bearer ${token}` };

  const getPendingChangesSummary = (listing: EquipmentListing) => {
    const pendingChanges = listing.pending_changes;
    if (!pendingChanges || typeof pendingChanges !== "object") {
      return null;
    }
    const keys = Object.keys(pendingChanges);
    return keys.length ? keys.join(", ") : null;
  };

  const clearPendingPhotos = () => {
    setPendingPhotos((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
  };

  const closeForm = () => {
    setShowForm(false);
    clearPendingPhotos();
    setForm(EMPTY_FORM);
  };

  useEffect(() => {
    return () => {
      pendingPhotos.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, [pendingPhotos]);

  const loadTypes = async () => {
    const urls = [`${baseURL}/equipment/types`, `${baseURL}/catalog/equipment-types`];

    for (const url of urls) {
      const response = await fetch(url);
      if (response.ok) {
        const loadedTypes: EquipmentTypeItem[] = await response.json();
        return loadedTypes.filter((item) => item.is_active);
      }
      if (response.status >= 500) {
        throw new Error("Не удалось загрузить типы техники");
      }
    }

    return [];
  };

  const loadSupplierListings = async () => {
    const urls = [`${baseURL}${apiPrefix}/equipment`, `${baseURL}${apiPrefix}/equipment/`];

    for (const url of urls) {
      const response = await fetch(url, { headers });
      if (response.ok) {
        const loadedListings: EquipmentListing[] = await response.json();
        return Array.isArray(loadedListings) ? loadedListings : [];
      }
      if (response.status >= 500) {
        throw new Error("Не удалось загрузить объявления");
      }
    }

    return [];
  };

  const load = async () => {
    setLoading(true);
    try {
      const [loadedTypes, loadedListings] = await Promise.all([
        loadTypes(),
        loadSupplierListings(),
      ]);
      setTypes(loadedTypes);
      setListings(loadedListings);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [token, apiPrefix]);

  useEffect(() => {
    setEquipmentOwnerName(currentUser?.name?.trim() || "");
  }, [currentUser?.name]);

  useEffect(() => {
    if (!requiresEquipmentOwnerName) {
      return;
    }

    const loadEquipmentOwnerProfile = async () => {
      try {
        const response = await fetch(`${baseURL}/equipment-owner/me`, { headers });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(extractApiErrorMessage(data, "Не удалось загрузить профиль"));
        }
        setEquipmentOwnerName((data.display_name || "").trim());
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Не удалось загрузить профиль");
      }
    };

    void loadEquipmentOwnerProfile();
  }, [requiresEquipmentOwnerName, token]);

  const openForm = (listing?: EquipmentListing) => {
    if (!listing && isEquipmentOwnerCreationBlocked) {
      toast.error("Сначала заполните ФИО в профиле");
      return;
    }
    const hourTariff = listing
      ? getEquipmentTariffs(listing).find((tariff) => tariff.type === "hour")
      : null;
    const shiftTariff = listing
      ? getEquipmentTariffs(listing).find((tariff) => tariff.type === "shift")
      : null;
    clearPendingPhotos();
    setForm(
      listing
        ? {
            id: listing.id,
            equipment_type: listing.equipment_type || listing.equipment_type_name,
            title: listing.title,
            description: listing.description,
            contact_phone: formatPhoneNumber(listing.contact_phone || ""),
            hourly_price: hourTariff?.price?.toString() || "",
            shift_hours: shiftTariff?.hours?.toString() || "",
            city: listing.city || "",
            district: listing.district || "",
          }
        : {
            ...EMPTY_FORM,
            equipment_type: types[0]?.name || "",
          },
    );
    setShowForm(true);
  };

  const appendPendingPhotos = (fileList: FileList | null) => {
    if (!fileList?.length) {
      return;
    }
    const nextItems = Array.from(fileList).map((file, index) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Date.now()}-${index}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setPendingPhotos((current) => [...current, ...nextItems]);
  };

  const removePendingPhoto = (indexToRemove: number) => {
    setPendingPhotos((current) => {
      const target = current[indexToRemove];
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((_, index) => index !== indexToRemove);
    });
  };

  const uploadPhotoFile = async (listingId: string, file: File, isPrimary: boolean) => {
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
    const presign = await presignResponse.json().catch(() => ({}));
    if (!presignResponse.ok) {
      throw new Error(
        extractApiErrorMessage(presign, "Не удалось подготовить загрузку"),
      );
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
    const confirmPayload = await confirmResponse.json().catch(() => ({}));
    if (!confirmResponse.ok) {
      throw new Error(
        extractApiErrorMessage(confirmPayload, "Не удалось подтвердить фотографию"),
      );
    }
  };

  const uploadPhotos = async (
    listingId: string,
    files: File[],
    existingCount = 0,
    options?: { showSuccess?: boolean },
  ) => {
    let currentCount = existingCount;
    for (const file of files) {
      await uploadPhotoFile(listingId, file, currentCount === 0);
      currentCount += 1;
    }

    if (files.length > 0 && options?.showSuccess !== false) {
      toast.success(
        files.length === 1
          ? "Фотография добавлена"
          : `Добавлено фотографий: ${files.length}`,
      );
    }
  };

  const getSupplierRouteMissingMessage = (mode: "list" | "create" | "update") => {
    if (mode === "list") {
      return "На сервере не подключён раздел объявлений поставщика. Требуется обновление backend.";
    }
    if (mode === "update") {
      return "На сервере не подключён маршрут редактирования объявлений поставщика. Требуется обновление backend.";
    }
    return "На сервере не подключён маршрут создания объявлений поставщика. Требуется обновление backend.";
  };

  const requestSupplierEquipmentSave = async (
    tariffs: Array<{ type: string; price: number; hours: number | null }>,
  ) => {
    const urls = form.id
      ? [
          `${baseURL}${apiPrefix}/equipment/${form.id}`,
          `${baseURL}${apiPrefix}/equipment/${form.id}/`,
        ]
      : [`${baseURL}${apiPrefix}/equipment`, `${baseURL}${apiPrefix}/equipment/`];
    let lastPayload: unknown = {};

    for (const url of urls) {
      const response = await fetch(url, {
        method: form.id ? "PATCH" : "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          equipment_type: form.equipment_type,
          title: form.title,
          description: form.description,
          contact_phone: normalizeContactPhoneForApi(form.contact_phone),
          tariffs,
          city: form.city || null,
          district: form.district || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        return data;
      }
      if (response.status !== 404) {
        throw new Error(
          extractApiErrorMessage(data, "Не удалось сохранить объявление"),
        );
      }
      lastPayload = data;
    }

    throw new Error(
      extractApiErrorMessage(
        lastPayload,
        getSupplierRouteMissingMessage(form.id ? "update" : "create"),
      ),
    );
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const isNewListing = !form.id;
    const hourlyPrice = Number(form.hourly_price);
    const shiftHours = form.shift_hours ? Number(form.shift_hours) : null;
    const tariffs = [
      { type: "hour", price: hourlyPrice, hours: null },
      ...(shiftHours
        ? [
            {
              type: "shift",
              price: hourlyPrice * shiftHours,
              hours: shiftHours,
            },
          ]
        : []),
    ];
    try {
      const savedListing = await requestSupplierEquipmentSave(tariffs);
      if (pendingPhotos.length > 0) {
        await uploadPhotos(
          savedListing.id,
          pendingPhotos.map((item) => item.file),
          Array.isArray(savedListing.media_files) ? savedListing.media_files.length : 0,
          { showSuccess: false },
        );
      }
      closeForm();
      if (isNewListing) {
        setTab("moderation");
      }
      toast.success(
        pendingPhotos.length > 0
          ? "Объявление и фото отправлены на модерацию"
          : "Объявление отправлено на модерацию",
      );
      await load();
      return;
      const response = await fetch(
        `${baseURL}/supplier/equipment${form.id ? `/${form.id}` : ""}`,
        {
          method: form.id ? "PATCH" : "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            equipment_type: form.equipment_type,
            title: form.title,
            description: form.description,
            tariffs,
            city: form.city || null,
            district: form.district || null,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          extractApiErrorMessage(data, "Не удалось сохранить объявление"),
        );
      }
      if (pendingPhotos.length > 0) {
        await uploadPhotos(
          data.id,
          pendingPhotos.map((item) => item.file),
          Array.isArray(data.media_files) ? data.media_files.length : 0,
          { showSuccess: false },
        );
      }
      closeForm();
      toast.success(
        pendingPhotos.length > 0
          ? "Объявление и фото отправлены на модерацию"
          : "Объявление отправлено на модерацию",
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const uploadPhoto = async (listing: EquipmentListing, file: File) => {
    try {
      await uploadPhotos(listing.id, [file], listing.media_files?.length || 0);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка загрузки");
    }
  };

  const deletePhoto = async (mediaId: string) => {
    if (!window.confirm("Удалить фотографию?")) return;
    const response = await fetch(`${baseURL}/media/${mediaId}`, {
      method: "DELETE",
      headers,
    });
    if (!response.ok) {
      toast.error("Не удалось удалить фотографию");
      return;
    }
    await load();
  };

  const toggleListingVisibility = async (listing: EquipmentListing) => {
    try {
      const response = await fetch(`${baseURL}${apiPrefix}/equipment/${listing.id}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: listing.is_active === false }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          extractApiErrorMessage(data, "Не удалось изменить статус объявления"),
        );
      }
      toast.success(listing.is_active === false ? "Объявление опубликовано" : "Объявление скрыто");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обновить объявление");
    }
  };

  const confirmListingRelevance = async (listing: EquipmentListing) => {
    try {
      const response = await fetch(`${baseURL}${apiPrefix}/equipment/${listing.id}/confirm-relevance`, {
        method: "POST",
        headers,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось подтвердить актуальность"));
      toast.success("Актуальность объявления подтверждена");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось подтвердить актуальность");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
      </div>
    );
  }

  const tabCounts: Record<ListingsTab, number> = {
    active: 0,
    moderation: 0,
    archived: 0,
  };

  listings.forEach((listing) => {
    if (matchesListingTab(listing, "active")) {
      tabCounts.active += 1;
    }
    if (matchesListingTab(listing, "moderation")) {
      tabCounts.moderation += 1;
    }
    if (matchesListingTab(listing, "archived")) {
      tabCounts.archived += 1;
    }
  });

  const filteredListings = listings.filter((listing) => matchesListingTab(listing, tab));
  const hasVisibleListings = filteredListings.length > 0;

  return (
    <main className="space-y-5 p-4">
      <div className="rounded-3xl bg-gradient-to-br from-sky-500 to-cyan-400 p-5 text-white shadow-lg">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-100">
          Спецтехника
        </p>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black">Мои объявления</h1>
            <p className="mt-1 text-sm text-sky-50">
              Новые и изменённые объявления проходят модерацию
            </p>
          </div>
          <button
            type="button"
            onClick={() => openForm()}
            disabled={isEquipmentOwnerCreationBlocked}
            className="rounded-2xl bg-white p-3 text-sky-600 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Добавить объявление"
          >
            <Plus className="h-6 w-6" />
          </button>
        </div>
      </div>

      {isEquipmentOwnerCreationBlocked ? (
        <div className="flex items-start gap-3 rounded-3xl border border-amber-200 bg-amber-50 px-4 py-4 text-amber-800 shadow-sm">
          <div className="rounded-2xl bg-amber-100 p-2 text-amber-700">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div>
            <p className="font-bold">Заполните профиль</p>
            <p className="mt-1 text-sm">
              Пожалуйста, заполните ФИО в Профиле, чтобы создавать объявления
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex gap-2 overflow-x-auto rounded-2xl bg-white p-2 shadow-sm">
        {(["active", "moderation", "archived"] as ListingsTab[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`shrink-0 rounded-xl px-5 py-3 text-sm font-bold transition ${
              tab === value ? "bg-sky-500 text-white" : "text-slate-500"
            }`}
          >
            {LISTING_TAB_LABELS[value]}
            {tabCounts[value] ? ` · ${tabCounts[value]}` : ""}
          </button>
        ))}
      </div>

      {listings.length === 0 || !hasVisibleListings ? (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-10 text-center">
          <ImageIcon className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-4 font-bold text-slate-700">Объявлений пока нет</p>
        </div>
      ) : (
        filteredListings.map((listing) => {
          const status = STATUS_META[listing.moderation_status || "pending_moderation"];
          return (
            <article key={listing.id} className="overflow-hidden rounded-3xl bg-white shadow-sm">
              <div className="relative bg-slate-100">
                {listing.primary_image_url ? (
                  <img
                    src={resolveMediaUrl(listing.primary_image_url) || "/placeholder.jpg"}
                    alt={listing.title}
                    className="h-48 w-full object-contain"
                  />
                ) : (
                  <div className="flex h-40 items-center justify-center">
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
                      if (file) void uploadPhoto(listing, file);
                      event.target.value = "";
                    }}
                  />
                </label>
              </div>
              <div className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${status.className}`}>
                      {status.label}
                    </span>
                    <h2 className="mt-2 text-lg font-black">{listing.title}</h2>
                    <p className="text-sm font-bold text-sky-600">{listing.equipment_type_name}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openForm(listing)}
                    className="rounded-xl bg-slate-100 p-2 text-slate-600"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2"><PlacementBadge status={listing.placement_status} /></div>
                <PlacementDates item={listing} />
                <PlacementExpirationWarning item={listing} />
                {listing.placement_status === "confirmation_required" ? <p className="rounded-xl bg-orange-50 p-3 text-sm font-semibold text-orange-800">Подтвердите актуальность в течение льготного периода.</p> : null}
                {listing.placement_status === "expired" ? <p className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">Срок размещения завершён. Для продления обратитесь к оператору.</p> : null}
                <p className="font-bold">{formatEquipmentPrice(listing)}</p>
                {listing.moderation_comment ? (
                  <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
                    <span className="font-bold">Комментарий модератора:</span>{" "}
                    {listing.moderation_comment}
                  </p>
                ) : null}
                {listing.moderation_status === "has_pending_changes" ? (
                  <p className="rounded-xl bg-sky-50 p-3 text-sm text-sky-700">
                    На модерации правки: {getPendingChangesSummary(listing) || "есть обновления"}
                  </p>
                ) : null}
                {listing.media_files?.length ? (
                  <div className="flex gap-2 overflow-x-auto">
                    {listing.media_files.map((media) => (
                      <div key={media.id} className="relative shrink-0">
                        <img
                          src={resolveMediaUrl(media.public_url) || "/placeholder.jpg"}
                          alt=""
                          className="h-16 w-20 rounded-lg object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => void deletePhoto(media.id)}
                          className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-rose-600"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => void toggleListingVisibility(listing)}
                  className={`w-full rounded-xl px-4 py-3 text-sm font-bold ${
                    listing.is_active === false
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {listing.is_active === false ? "Опубликовать" : "Скрыть"}
                </button>
                {shouldShowConfirmationAction(listing) ? <button type="button" onClick={() => void confirmListingRelevance(listing)} className="w-full rounded-xl bg-orange-50 px-4 py-3 text-sm font-bold text-orange-800">Подтвердить актуальность</button> : null}
              </div>
            </article>
          );
        })
      )}

      {showForm ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={save}
            className="max-h-[92vh] w-full max-w-md space-y-4 overflow-y-auto rounded-3xl bg-white p-6"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black">
                {form.id ? "Редактировать объявление" : "Новое объявление"}
              </h2>
              <button type="button" onClick={closeForm}>
                <X />
              </button>
            </div>
            <label className="block text-sm font-bold">
              Тип техники
              <input
                required
                list="supplier-equipment-types"
                value={form.equipment_type}
                onChange={(event) => setForm({ ...form, equipment_type: event.target.value })}
                className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal"
                placeholder="Можно ввести свой тип"
              />
              <datalist id="supplier-equipment-types">
                {types.map((item) => <option key={item.id} value={item.name} />)}
              </datalist>
            </label>
            <label className="block text-sm font-bold">
              Фотографии
              <div className="mt-2 space-y-3">
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-sky-200 bg-sky-50/70 px-4 py-6 text-center transition-colors hover:border-sky-300 hover:bg-sky-50">
                  <UploadCloud className="h-8 w-8 text-sky-500" />
                  <span className="mt-2 text-sm font-bold text-sky-700">
                    Добавить фотографии
                  </span>
                  <span className="mt-1 text-xs font-normal text-slate-500">
                    JPG, PNG, WebP. Можно выбрать несколько файлов.
                  </span>
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={(event) => {
                      appendPendingPhotos(event.target.files);
                      event.target.value = "";
                    }}
                    className="hidden"
                  />
                </label>
                {pendingPhotoPreviews.length > 0 ? (
                  <div className="grid grid-cols-3 gap-3">
                    {pendingPhotoPreviews.map((previewUrl, index) => (
                      <div key={`${previewUrl}-${index}`} className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                        <img
                          src={previewUrl}
                          alt={`Фото ${index + 1}`}
                          className="h-24 w-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removePendingPhoto(index)}
                          className="absolute right-2 top-2 rounded-full bg-white/95 p-1.5 text-rose-600 shadow-sm"
                          aria-label={`Удалить фото ${index + 1}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs font-normal text-slate-500">
                    Можно добавить фото сразу при создании или редактировании объявления.
                  </p>
                )}
              </div>
            </label>
            <label className="block text-sm font-bold">
              Название
              <input
                required
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal"
              />
            </label>
            <label className="block text-sm font-bold">
              Описание
              <textarea
                required
                rows={4}
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal"
              />
            </label>
            <label className="block text-sm font-bold">
              Контактный телефон
              <input
                value={form.contact_phone}
                onChange={(event) =>
                  setForm({ ...form, contact_phone: formatPhoneNumber(event.target.value) })
                }
                className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal"
                placeholder="+7 (999) 000-00-00"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm font-bold">
                Цена за час
                <input
                  required
                  type="number"
                  min="1"
                  value={form.hourly_price}
                  onChange={(event) => setForm({ ...form, hourly_price: event.target.value })}
                  className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal"
                />
              </label>
              <label className="text-sm font-bold">
                Часов в смене
                <input
                  type="number"
                  min="1"
                  max="24"
                  value={form.shift_hours}
                  onChange={(event) => setForm({ ...form, shift_hours: event.target.value })}
                  className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal"
                  placeholder="Необязательно"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm font-bold">
                Город
                <input
                  value={form.city}
                  onChange={(event) => setForm({ ...form, city: event.target.value })}
                  className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal"
                />
              </label>
              <label className="text-sm font-bold">
                Район
                <input
                  value={form.district}
                  onChange={(event) => setForm({ ...form, district: event.target.value })}
                  className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal"
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-xl bg-sky-500 p-3 font-bold text-white disabled:opacity-50"
            >
              {saving ? "Сохранение..." : "Сохранить и отправить на модерацию"}
            </button>
          </form>
        </div>
      ) : null}
    </main>
  );
}
