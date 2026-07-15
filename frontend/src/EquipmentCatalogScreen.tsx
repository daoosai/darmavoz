import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Headphones, ImageIcon, MapPin, Wrench, X } from "lucide-react";
import toast from "react-hot-toast";
import { useAuthStore } from "./store";
import { baseURL, extractApiErrorMessage, resolveMediaUrl } from "./utils";
import SupportScreen from "./SupportScreen";

export interface EquipmentTypeItem {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  sort_order: number;
}

export interface EquipmentListing {
  id: string;
  equipment_type_id: string;
  equipment_type_name: string;
  title: string;
  description: string;
  price_amount?: number | null;
  price_unit: "hour" | "shift" | "day" | "negotiable";
  city?: string | null;
  district?: string | null;
  is_active: boolean;
  sort_order: number;
  primary_image_url?: string | null;
  media_files?: { id: string; public_url: string; is_primary?: boolean }[];
}

const priceUnits: Record<string, string> = {
  hour: "час",
  shift: "смена",
  day: "день",
};

export const formatEquipmentPrice = (item: EquipmentListing) =>
  item.price_unit === "negotiable" || item.price_amount == null
    ? "Цена договорная"
    : `${Number(item.price_amount).toLocaleString("ru-RU")} ₽/${priceUnits[item.price_unit]}`;

interface Props {
  onOpenAuth: () => void;
}

export default function EquipmentCatalogScreen({ onOpenAuth }: Props) {
  const { token, role } = useAuthStore();
  const [types, setTypes] = useState<EquipmentTypeItem[]>([]);
  const [listings, setListings] = useState<EquipmentListing[]>([]);
  const [selectedType, setSelectedType] = useState("");
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("");
  const [selected, setSelected] = useState<EquipmentListing | null>(null);
  const [showApplication, setShowApplication] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [waitingForAuth, setWaitingForAuth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    object_address: "",
    requested_date: "",
    requested_time: "",
    duration_value: "1",
    duration_unit: "hours",
    contact_phone: "",
    comment: "",
  });

  const load = async () => {
    setLoading(true);
    try {
      const [typesResponse, listingsResponse] = await Promise.all([
        fetch(`${baseURL}/catalog/equipment-types`),
        fetch(`${baseURL}/catalog/equipment`),
      ]);
      if (!typesResponse.ok || !listingsResponse.ok) throw new Error("catalog");
      setTypes(await typesResponse.json());
      setListings(await listingsResponse.json());
    } catch {
      toast.error("Не удалось загрузить каталог спецтехники");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (waitingForAuth && token && role === "client") {
      setWaitingForAuth(false);
      setShowApplication(true);
    }
  }, [waitingForAuth, token, role]);

  useEffect(() => {
    if (!showApplication || !token || role !== "client" || form.contact_phone) return;
    fetch(`${baseURL}/clients/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => (response.ok ? response.json() : null))
      .then((client) => {
        if (client?.phone) setForm((previous) => ({ ...previous, contact_phone: client.phone }));
      })
      .catch(() => undefined);
  }, [showApplication, token, role, form.contact_phone]);

  const cities = useMemo(
    () => Array.from(new Set(listings.map((item) => item.city).filter(Boolean) as string[])).sort(),
    [listings],
  );
  const filtered = listings.filter((item) => {
    const matchesType = !selectedType || item.equipment_type_id === selectedType;
    const matchesCity = !city || item.city === city;
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || `${item.title} ${item.description}`.toLowerCase().includes(query);
    return matchesType && matchesCity && matchesSearch;
  });

  const startApplication = () => {
    if (!token || role !== "client") {
      setWaitingForAuth(true);
      onOpenAuth();
      return;
    }
    setShowApplication(true);
  };

  const submitApplication = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !token) return;
    setSubmitting(true);
    try {
      const response = await fetch(`${baseURL}/client/equipment-applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...form,
          listing_id: selected.id,
          duration_value: Number(form.duration_value),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось отправить заявку"));
      toast.success(`Заявка №${String(data.id).slice(0, 8)} принята`);
      setShowApplication(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отправить заявку");
    } finally {
      setSubmitting(false);
    }
  };

  if (selected) {
    if (showSupport) {
      return (
        <SupportScreen
          onBack={() => setShowSupport(false)}
          initialContext={{
            type: "equipment_listing",
            id: selected.id,
            subject: `Вопрос по объявлению «${selected.title}»`,
          }}
        />
      );
    }
    const photos = selected.media_files?.length
      ? selected.media_files
      : selected.primary_image_url
        ? [{ id: "primary", public_url: selected.primary_image_url }]
        : [];
    return (
      <div className="px-4 pb-8">
        <button onClick={() => setSelected(null)} className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-600">
          <ArrowLeft className="h-4 w-4" /> К каталогу
        </button>
        <div className="overflow-hidden rounded-3xl bg-white shadow-sm">
          <div className="flex snap-x gap-2 overflow-x-auto">
            {photos.length ? photos.map((photo) => (
              <img key={photo.id} src={resolveMediaUrl(photo.public_url) || "/placeholder.jpg"} alt={selected.title} className="h-64 w-full shrink-0 snap-start object-cover" />
            )) : (
              <div className="flex h-64 w-full items-center justify-center bg-slate-100"><ImageIcon className="h-12 w-12 text-slate-300" /></div>
            )}
          </div>
          <div className="p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-sky-600">{selected.equipment_type_name}</p>
            <h2 className="mt-1 text-2xl font-black text-slate-900">{selected.title}</h2>
            {(selected.city || selected.district) && (
              <p className="mt-2 flex items-center gap-1 text-sm text-slate-500"><MapPin className="h-4 w-4" /> {[selected.city, selected.district].filter(Boolean).join(", ")}</p>
            )}
            <p className="mt-4 text-xl font-black text-sky-600">{formatEquipmentPrice(selected)}</p>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-600">{selected.description}</p>
            <button onClick={startApplication} className="mt-6 w-full rounded-2xl bg-sky-500 px-5 py-4 font-bold text-white shadow-sm active:bg-sky-600">
              Оставить заявку
            </button>
            <button
              onClick={() => {
                if (!token || role !== "client") {
                  onOpenAuth();
                  return;
                }
                setShowSupport(true);
              }}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-100 px-5 py-3 font-bold text-slate-600"
            >
              <Headphones className="h-4 w-4" /> Задать вопрос оператору
            </button>
          </div>
        </div>
        {showApplication && (
          <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
            <form onSubmit={submitApplication} className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
              <div className="mb-5 flex items-center justify-between">
                <div><p className="text-xs font-bold text-sky-600">ЗАЯВКА НА ТЕХНИКУ</p><h3 className="text-xl font-black">{selected.title}</h3></div>
                <button type="button" onClick={() => setShowApplication(false)} className="rounded-full bg-slate-100 p-2"><X className="h-5 w-5" /></button>
              </div>
              <div className="space-y-4">
                <label className="block text-sm font-bold">Адрес объекта<input required value={form.object_address} onChange={(e) => setForm({ ...form, object_address: e.target.value })} className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal outline-none" /></label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm font-bold">Дата<input required type="date" min={new Date().toISOString().slice(0, 10)} value={form.requested_date} onChange={(e) => setForm({ ...form, requested_date: e.target.value })} className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal" /></label>
                  <label className="text-sm font-bold">Время<input required type="time" value={form.requested_time} onChange={(e) => setForm({ ...form, requested_time: e.target.value })} className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal" /></label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm font-bold">Количество<input required type="number" min="1" step="0.5" value={form.duration_value} onChange={(e) => setForm({ ...form, duration_value: e.target.value })} className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal" /></label>
                  <label className="text-sm font-bold">Единица<select value={form.duration_unit} onChange={(e) => setForm({ ...form, duration_unit: e.target.value })} className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal"><option value="hours">Часы</option><option value="shifts">Смены</option></select></label>
                </div>
                <label className="block text-sm font-bold">Телефон<input required value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal" /></label>
                <label className="block text-sm font-bold">Комментарий<textarea value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} rows={3} className="mt-1 w-full resize-none rounded-xl bg-slate-100 p-3 font-normal" /></label>
              </div>
              <button disabled={submitting} className="mt-5 w-full rounded-2xl bg-sky-500 p-4 font-bold text-white disabled:opacity-50">{submitting ? "Отправляем..." : "Отправить заявку"}</button>
            </form>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="px-4 pb-8">
      <div className="mb-5">
        <div className="flex items-center gap-2"><Wrench className="h-6 w-6 text-sky-500" /><h2 className="text-2xl font-black">Спецтехника</h2></div>
        <p className="mt-1 text-sm text-slate-500">Техника и услуги для вашего объекта</p>
      </div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск техники..." className="mb-3 w-full rounded-2xl bg-white p-3 shadow-sm outline-none" />
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => setSelectedType("")} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${!selectedType ? "bg-sky-500 text-white" : "bg-white text-slate-600"}`}>Все</button>
        {types.map((type) => <button key={type.id} onClick={() => setSelectedType(type.id)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${selectedType === type.id ? "bg-sky-500 text-white" : "bg-white text-slate-600"}`}>{type.name}</button>)}
      </div>
      {cities.length > 0 && <select value={city} onChange={(e) => setCity(e.target.value)} className="mb-4 w-full rounded-xl bg-white p-3 text-sm"><option value="">Все города и районы</option>{cities.map((item) => <option key={item}>{item}</option>)}</select>}
      {loading ? <p className="py-12 text-center text-slate-400">Загрузка...</p> : filtered.length === 0 ? <p className="rounded-2xl bg-white p-8 text-center text-slate-500">Подходящая техника пока не добавлена</p> : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {filtered.map((item) => <button key={item.id} onClick={() => setSelected(item)} className="overflow-hidden rounded-2xl bg-white text-left shadow-sm">
            {item.primary_image_url ? <img src={resolveMediaUrl(item.primary_image_url) || "/placeholder.jpg"} alt={item.title} className="h-40 w-full object-cover" /> : <div className="flex h-40 items-center justify-center bg-slate-100"><ImageIcon className="h-9 w-9 text-slate-300" /></div>}
            <div className="p-4"><p className="text-xs font-bold text-sky-600">{item.equipment_type_name}</p><h3 className="mt-1 text-lg font-black">{item.title}</h3><p className="mt-2 font-bold text-slate-900">{formatEquipmentPrice(item)}</p>{(item.city || item.district) && <p className="mt-2 flex items-center gap-1 text-xs text-slate-500"><MapPin className="h-3 w-3" />{[item.city, item.district].filter(Boolean).join(", ")}</p>}</div>
          </button>)}
        </div>
      )}
    </div>
  );
}
