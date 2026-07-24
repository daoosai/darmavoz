import { type FormEvent, useEffect, useState } from "react";
import { Edit2, ImageIcon, Loader2, Plus, UploadCloud, X } from "lucide-react";
import toast from "react-hot-toast";

import {
  type EquipmentListing,
  type EquipmentTypeItem,
  formatEquipmentPrice,
  getEquipmentTariffs,
} from "./EquipmentCatalogScreen";
import { baseURL, extractApiErrorMessage, resolveMediaUrl } from "./utils";

interface Props {
  token: string;
}

interface EquipmentForm {
  id: string;
  equipment_type: string;
  title: string;
  description: string;
  hourly_price: string;
  shift_hours: string;
  city: string;
  district: string;
}

const EMPTY_FORM: EquipmentForm = {
  id: "",
  equipment_type: "",
  title: "",
  description: "",
  hourly_price: "",
  shift_hours: "",
  city: "",
  district: "",
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

export default function SupplierEquipmentScreen({ token }: Props) {
  const [types, setTypes] = useState<EquipmentTypeItem[]>([]);
  const [listings, setListings] = useState<EquipmentListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<EquipmentForm>(EMPTY_FORM);

  const headers = { Authorization: `Bearer ${token}` };

  const load = async () => {
    setLoading(true);
    try {
      const [typesResponse, listingsResponse] = await Promise.all([
        fetch(`${baseURL}/equipment/types`),
        fetch(`${baseURL}/supplier/equipment`, { headers }),
      ]);
      if (!typesResponse.ok || !listingsResponse.ok) {
        throw new Error("Не удалось загрузить объявления");
      }
      const loadedTypes: EquipmentTypeItem[] = await typesResponse.json();
      setTypes(loadedTypes.filter((item) => item.is_active));
      setListings(await listingsResponse.json());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  const openForm = (listing?: EquipmentListing) => {
    const hourTariff = listing
      ? getEquipmentTariffs(listing).find((tariff) => tariff.type === "hour")
      : null;
    const shiftTariff = listing
      ? getEquipmentTariffs(listing).find((tariff) => tariff.type === "shift")
      : null;
    setForm(
      listing
        ? {
            id: listing.id,
            equipment_type: listing.equipment_type || listing.equipment_type_name,
            title: listing.title,
            description: listing.description,
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

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
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
      setShowForm(false);
      toast.success("Объявление отправлено на модерацию");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const uploadPhoto = async (listing: EquipmentListing, file: File) => {
    try {
      const isPrimary = !listing.media_files?.length;
      const presignResponse = await fetch(`${baseURL}/media/presign-upload`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: "equipment_listing",
          entity_id: listing.id,
          file_name: file.name,
          content_type: file.type,
          file_size: file.size,
          is_primary: isPrimary,
        }),
      });
      const presign = await presignResponse.json();
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
      if (!uploadResponse.ok) throw new Error("Не удалось загрузить фотографию");
      const confirmResponse = await fetch(`${baseURL}/media/confirm`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: "equipment_listing",
          entity_id: listing.id,
          object_key: presign.object_key,
          file_name: file.name,
          content_type: file.type,
          file_size: file.size,
          is_primary: isPrimary,
        }),
      });
      if (!confirmResponse.ok) throw new Error("Не удалось подтвердить фотографию");
      toast.success("Фотография добавлена");
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

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
      </div>
    );
  }

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
            className="rounded-2xl bg-white p-3 text-sky-600 shadow-sm"
            aria-label="Добавить объявление"
          >
            <Plus className="h-6 w-6" />
          </button>
        </div>
      </div>

      {listings.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-10 text-center">
          <ImageIcon className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-4 font-bold text-slate-700">Объявлений пока нет</p>
        </div>
      ) : (
        listings.map((listing) => {
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
                <p className="font-bold">{formatEquipmentPrice(listing)}</p>
                {listing.moderation_comment ? (
                  <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
                    <span className="font-bold">Комментарий модератора:</span>{" "}
                    {listing.moderation_comment}
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
              <button type="button" onClick={() => setShowForm(false)}>
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
