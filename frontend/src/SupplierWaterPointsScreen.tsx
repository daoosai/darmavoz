import { useEffect, useState, type FormEvent } from "react";
import { Droplets, Loader2, MapPin, Phone, Plus, Upload } from "lucide-react";
import toast from "react-hot-toast";

import { baseURL, extractApiErrorMessage, resolveMediaUrl } from "./utils";

type WaterType = "free" | "paid";

interface WaterPoint {
  id: string;
  water_type: WaterType;
  name?: string | null;
  source: string;
  address: string;
  lat: number;
  lon: number;
  phone?: string | null;
  price?: number | null;
  price_unit?: string | null;
  description?: string | null;
  primary_image_url?: string | null;
  moderation_status: string;
  moderation_comment?: string | null;
}

const EMPTY_FORM = {
  water_type: "free" as WaterType,
  name: "",
  source: "",
  address: "",
  lat: "",
  lon: "",
  phone: "",
  price: "",
  price_unit: "литр",
  description: "",
};

const statusText: Record<string, string> = {
  pending_moderation: "На модерации",
  approved: "Одобрено",
  rejected: "Отклонено",
  suspended: "Приостановлено",
};

export default function SupplierWaterPointsScreen({ token }: { token: string }) {
  const [points, setPoints] = useState<WaterPoint[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const loadPoints = async () => {
    const response = await fetch(`${baseURL}/supplier/water-points`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => []);
    if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось загрузить точки воды"));
    setPoints(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    void loadPoints().catch((error) => toast.error(error instanceof Error ? error.message : "Не удалось загрузить точки воды"));
  }, [token]);

  const update = (field: keyof typeof EMPTY_FORM, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const isPaid = form.water_type === "paid";
    if (isPaid && (!form.phone.trim() || !form.price || !form.price_unit.trim())) {
      toast.error("Для платной воды обязательно заполните телефон, цену и единицу измерения.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        water_type: form.water_type,
        name: form.name.trim() || null,
        source: form.source.trim(),
        address: form.address.trim(),
        lat: Number(form.lat),
        lon: Number(form.lon),
        phone: form.phone.trim() || null,
        price: isPaid ? Number(form.price) : null,
        price_unit: isPaid ? form.price_unit.trim() : null,
        description: isPaid ? form.description.trim() : null,
      };
      const response = await fetch(`${baseURL}/supplier/water-points`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось сохранить точку воды"));
      toast.success("Точка воды отправлена на модерацию.");
      setForm(EMPTY_FORM);
      setShowForm(false);
      await loadPoints();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить точку воды");
    } finally {
      setSaving(false);
    }
  };

  const uploadPhoto = async (point: WaterPoint, file: File) => {
    setUploadingId(point.id);
    try {
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
      const presignResponse = await fetch(`${baseURL}/media/presign-upload`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          entity_type: "water_point",
          entity_id: point.id,
          file_name: file.name,
          content_type: file.type,
          file_size: file.size,
          is_primary: !point.primary_image_url,
        }),
      });
      const presign = await presignResponse.json().catch(() => ({}));
      if (!presignResponse.ok) throw new Error(extractApiErrorMessage(presign, "Не удалось подготовить загрузку фото"));
      const uploadResponse = await fetch(presign.upload_url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadResponse.ok) throw new Error("Не удалось загрузить фотографию в хранилище");
      const confirmResponse = await fetch(`${baseURL}/media/confirm`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          entity_type: "water_point",
          entity_id: point.id,
          object_key: presign.object_key,
          file_name: file.name,
          content_type: file.type,
          file_size: file.size,
          is_primary: !point.primary_image_url,
        }),
      });
      const confirmed = await confirmResponse.json().catch(() => ({}));
      if (!confirmResponse.ok) throw new Error(extractApiErrorMessage(confirmed, "Не удалось подтвердить фото"));
      await loadPoints();
      toast.success("Фотография загружена.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить фотографию");
    } finally {
      setUploadingId(null);
    }
  };

  const isPaid = form.water_type === "paid";
  return (
    <div className="space-y-4 px-4 pb-24 pt-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3"><span className="rounded-2xl bg-sky-100 p-3 text-sky-600"><Droplets /></span><div><h1 className="text-xl font-black">Точки воды</h1><p className="text-sm text-slate-500">Бесплатная и платная вода</p></div></div>
        <button type="button" onClick={() => setShowForm((value) => !value)} className="rounded-xl bg-sky-500 p-3 text-white" aria-label="Добавить точку воды"><Plus /></button>
      </div>

      {showForm ? <form onSubmit={submit} className="space-y-4 rounded-3xl bg-white p-4 shadow-sm">
        <h2 className="font-black">Новая точка воды</h2>
        <label className="block text-sm font-bold">Тип воды<select value={form.water_type} onChange={(event) => update("water_type", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3"><option value="free">Бесплатная вода</option><option value="paid">Платная вода</option></select></label>
        <label className="block text-sm font-bold">Название {isPaid ? <span className="text-red-500">*</span> : <span className="font-normal text-slate-400">(необязательно)</span>}<input required={isPaid} value={form.name} onChange={(event) => update("name", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3" /></label>
        <label className="block text-sm font-bold">Источник <span className="text-red-500">*</span><input required value={form.source} onChange={(event) => update("source", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3" /></label>
        <label className="block text-sm font-bold">Адрес <span className="text-red-500">*</span><input required value={form.address} onChange={(event) => update("address", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3" /></label>
        <div className="grid grid-cols-2 gap-3"><label className="text-sm font-bold">Широта <span className="text-red-500">*</span><input required type="number" step="any" min="-90" max="90" value={form.lat} onChange={(event) => update("lat", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3" /></label><label className="text-sm font-bold">Долгота <span className="text-red-500">*</span><input required type="number" step="any" min="-180" max="180" value={form.lon} onChange={(event) => update("lon", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3" /></label></div>
        <label className="block text-sm font-bold">Телефон {isPaid ? <span className="text-red-500">*</span> : <span className="font-normal text-slate-400">(необязательно)</span>}<input required={isPaid} type="tel" value={form.phone} onChange={(event) => update("phone", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3" /></label>
        {isPaid ? <><div className="grid grid-cols-2 gap-3"><label className="text-sm font-bold">Цена <span className="text-red-500">*</span><input required type="number" min="0.01" step="0.01" value={form.price} onChange={(event) => update("price", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3" /></label><label className="text-sm font-bold">Единица <span className="text-red-500">*</span><input required value={form.price_unit} onChange={(event) => update("price_unit", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3" /></label></div><label className="block text-sm font-bold">Описание <span className="text-red-500">*</span><textarea required value={form.description} onChange={(event) => update("description", event.target.value)} className="mt-1 min-h-20 w-full rounded-xl border border-slate-200 p-3" /></label></> : null}
        <button disabled={saving} className="flex w-full items-center justify-center rounded-xl bg-sky-500 py-3 font-bold text-white disabled:opacity-50">{saving ? <Loader2 className="animate-spin" /> : "Отправить на модерацию"}</button>
      </form> : null}

      {points.map((point) => <article key={point.id} className="overflow-hidden rounded-3xl bg-white shadow-sm">{point.primary_image_url ? <img className="h-32 w-full object-cover" src={resolveMediaUrl(point.primary_image_url)} alt={point.name || point.source} /> : null}<div className="space-y-2 p-4"><div className="flex items-start justify-between gap-2"><div><h2 className="font-black">{point.name || point.source}</h2><p className="text-sm text-slate-500">{point.source}</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">{statusText[point.moderation_status] || point.moderation_status}</span></div><p className="flex gap-2 text-sm text-slate-600"><MapPin className="h-4 w-4 shrink-0" />{point.address}</p>{point.phone ? <p className="flex gap-2 text-sm text-slate-600"><Phone className="h-4 w-4" />{point.phone}</p> : null}{point.moderation_comment ? <p className="rounded-xl bg-red-50 p-2 text-sm text-red-700">{point.moderation_comment}</p> : null}<label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-100 py-2 text-sm font-bold text-slate-700"><Upload className="h-4 w-4" />{uploadingId === point.id ? "Загрузка…" : "Загрузить фото"}<input className="hidden" type="file" accept="image/*" disabled={uploadingId === point.id} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadPhoto(point, file); event.currentTarget.value = ""; }} /></label></div></article>)}
    </div>
  );
}
