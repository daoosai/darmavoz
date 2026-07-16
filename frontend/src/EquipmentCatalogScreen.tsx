import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Headphones, ImageIcon, MapPin, Wrench, X } from "lucide-react";
import toast from "react-hot-toast";
import { useAuthStore } from "./store";
import { baseURL, extractApiErrorMessage, resolveMediaUrl } from "./utils";
import { fetch2gisAddressSuggestions } from "./addressSearch";
import SupportScreen from "./SupportScreen";

export interface EquipmentTypeItem {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  sort_order: number;
}

export interface EquipmentTariff {
  type: "hour" | "shift";
  price: number | null;
  hours?: number | null;
}

export interface EquipmentListing {
  id: string;
  equipment_type_id: string;
  equipment_type_name: string;
  title: string;
  description: string;
  tariffs?: EquipmentTariff[];
  price_amount?: number | null;
  price_unit?: "hour" | "shift" | "day" | "negotiable";
  city?: string | null;
  district?: string | null;
  is_active: boolean;
  sort_order: number;
  primary_image_url?: string | null;
  media_files?: { id: string; public_url: string; is_primary?: boolean }[];
}

interface EquipmentApplicationSummary {
  id: string;
  listing_id: string;
  status: "new" | "in_progress" | "closed" | "completed" | "rejected" | "cancelled";
}

export const getEquipmentTariffs = (item: EquipmentListing): EquipmentTariff[] => {
  if (item.tariffs?.length) return item.tariffs;
  if (item.price_amount == null || item.price_unit === "negotiable") {
    return [{ type: "hour", price: null }];
  }
  if (item.price_unit === "shift") {
    return [
      { type: "hour", price: Number(item.price_amount) },
      { type: "shift", hours: 1, price: Number(item.price_amount) },
    ];
  }
  return [{ type: "hour", price: Number(item.price_amount) }];
};

export const formatEquipmentPrice = (item: EquipmentListing) => {
  const tariffs = getEquipmentTariffs(item);
  const hourTariff = tariffs.find((tariff) => tariff.type === "hour");
  const shiftTariff = tariffs.find((tariff) => tariff.type === "shift");
  if (hourTariff?.price == null) return "Цена договорная";
  const hourLabel = `${Number(hourTariff.price).toLocaleString("ru-RU")} ₽/час`;
  return shiftTariff?.price != null
    ? `${hourLabel} · ${Number(shiftTariff.price).toLocaleString("ru-RU")} ₽/смена`
    : hourLabel;
};

interface Props {
  onOpenAuth: () => void;
}

export default function EquipmentCatalogScreen({ onOpenAuth }: Props) {
  const { token, role } = useAuthStore();
  const [types, setTypes] = useState<EquipmentTypeItem[]>([]);
  const [listings, setListings] = useState<EquipmentListing[]>([]);
  const [applications, setApplications] = useState<EquipmentApplicationSummary[]>([]);
  const [selectedType, setSelectedType] = useState("");
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("");
  const [selected, setSelected] = useState<EquipmentListing | null>(null);
  const [showApplication, setShowApplication] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [waitingForAuth, setWaitingForAuth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<string[]>([]);
  const [addressSelected, setAddressSelected] = useState(false);
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
        fetch(`${baseURL}/equipment/types`),
        fetch(`${baseURL}/equipment`),
      ]);
      if (!typesResponse.ok || !listingsResponse.ok) throw new Error("catalog");
      const loadedTypes: EquipmentTypeItem[] = await typesResponse.json();
      setTypes(loadedTypes.filter((item) => item.is_active));
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
    if (!token || role !== "client") {
      setApplications([]);
      return;
    }
    fetch(`${baseURL}/client/equipment-applications`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("applications"))))
      .then((data: EquipmentApplicationSummary[]) => setApplications(data))
      .catch(() => setApplications([]));
  }, [token, role]);

  useEffect(() => {
    if (waitingForAuth && token && role === "client") {
      setWaitingForAuth(false);
      setShowApplication(true);
    }
  }, [waitingForAuth, token, role]);

  useEffect(() => {
    if (!selected) return;
    const tariffs = getEquipmentTariffs(selected);
    const desiredType = form.duration_unit === "hours" ? "hour" : "shift";
    if (!tariffs.some((tariff) => tariff.type === desiredType)) {
      setForm((previous) => ({
        ...previous,
        duration_unit: tariffs[0]?.type === "shift" ? "shifts" : "hours",
      }));
    }
  }, [selected?.id]);

  useEffect(() => {
    if (!showApplication || !token || role !== "client" || form.contact_phone) return;
    fetch(`${baseURL}/clients/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => (response.ok ? response.json() : null))
      .then((client) => {
        if (client?.phone) setForm((previous) => ({ ...previous, contact_phone: client.phone }));
      })
      .catch(() => undefined);
  }, [showApplication, token, role, form.contact_phone]);

  useEffect(() => {
    if (!showApplication || addressSelected || form.object_address.trim().length < 3) {
      setAddressSuggestions([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void fetch2gisAddressSuggestions(form.object_address).then((items) => {
        if (!active) return;
        setAddressSuggestions(
          items
            .map((item: any) => item.search_attributes?.suggested_text || item.full_name || item.name)
            .filter(Boolean),
        );
      });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [showApplication, form.object_address, addressSelected]);

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
  const activeApplicationListingIds = useMemo(
    () => new Set(
      applications
        .filter((item) => item.status === "new" || item.status === "in_progress")
        .map((item) => item.listing_id),
    ),
    [applications],
  );
  const selectedTariffs = selected ? getEquipmentTariffs(selected) : [];
  const selectedTariff = selectedTariffs.find(
    (tariff) => tariff.type === (form.duration_unit === "hours" ? "hour" : "shift"),
  );
  const calculatedTotal = selectedTariff?.price == null
    ? null
    : Number(form.duration_value || 0) * Number(selectedTariff.price);

  const startApplication = () => {
    if (selected && activeApplicationListingIds.has(selected.id)) return;
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
          total_price: calculatedTotal,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось отправить заявку"));
      setApplications((previous) => [data, ...previous]);
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
    const hasActiveApplication = activeApplicationListingIds.has(selected.id);
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
            <button disabled={hasActiveApplication} onClick={startApplication} className="mt-6 w-full rounded-2xl bg-sky-500 px-5 py-4 font-bold text-white shadow-sm active:bg-sky-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600">
              {hasActiveApplication ? "Заявка уже отправлена" : "Оставить заявку"}
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
                <label className="relative block text-sm font-bold">Адрес объекта<input required value={form.object_address} onChange={(e) => { setAddressSelected(false); setForm({ ...form, object_address: e.target.value }); }} placeholder="Начните вводить адрес" className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal outline-none" />{addressSuggestions.length > 0 && <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white text-sm font-normal shadow-xl">{addressSuggestions.map((address) => <li key={address}><button type="button" onClick={() => { setForm({ ...form, object_address: address }); setAddressSelected(true); setAddressSuggestions([]); }} className="flex w-full items-start gap-2 border-b border-slate-100 px-3 py-3 text-left last:border-0 hover:bg-slate-50"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />{address}</button></li>)}</ul>}</label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm font-bold">Дата<input required type="date" min={new Date().toISOString().slice(0, 10)} value={form.requested_date} onChange={(e) => setForm({ ...form, requested_date: e.target.value })} className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal" /></label>
                  <label className="text-sm font-bold">Время<input required type="time" value={form.requested_time} onChange={(e) => setForm({ ...form, requested_time: e.target.value })} className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal" /></label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm font-bold">Тип аренды<select value={form.duration_unit} onChange={(e) => setForm({ ...form, duration_unit: e.target.value })} className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal">{selectedTariffs.map((tariff) => <option key={tariff.type} value={tariff.type === "hour" ? "hours" : "shifts"}>{tariff.type === "hour" ? "Часы" : "Смены"}</option>)}</select></label>
                  <label className="text-sm font-bold">Количество<input required type="number" min="1" step="0.5" value={form.duration_value} onChange={(e) => setForm({ ...form, duration_value: e.target.value })} className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal" /></label>
                </div>
                <label className="block text-sm font-bold">Телефон<input required value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal" /></label>
                <label className="block text-sm font-bold">Комментарий<textarea value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} rows={3} className="mt-1 w-full resize-none rounded-xl bg-slate-100 p-3 font-normal" /></label>
                <div className="rounded-2xl bg-sky-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-sky-600">Итого</p><p className="mt-1 text-2xl font-black text-slate-900">{calculatedTotal == null ? "По договорённости" : `${calculatedTotal.toLocaleString("ru-RU")} ₽`}</p></div>
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
