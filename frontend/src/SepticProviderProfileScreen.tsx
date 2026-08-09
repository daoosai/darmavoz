import { useEffect, useState, type FormEvent } from "react";
import { Droplets, Loader2, MapPin, Phone, Wallet } from "lucide-react";
import toast from "react-hot-toast";

import { baseURL, extractApiErrorMessage } from "./utils";

interface SepticForm {
  phone: string;
  address: string;
  lat: string;
  lon: string;
  tank_volume_m3: string;
  service_price: string;
}

const EMPTY_FORM: SepticForm = {
  phone: "",
  address: "",
  lat: "",
  lon: "",
  tank_volume_m3: "",
  service_price: "",
};

export default function SepticProviderProfileScreen({ token }: { token: string }) {
  const [form, setForm] = useState<SepticForm>(EMPTY_FORM);
  const [status, setStatus] = useState<string | null>(null);
  const [comment, setComment] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let disposed = false;
    void fetch(`${baseURL}/equipment-owner/septic-profile`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (response.status === 404) return null;
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось загрузить анкету"));
        return data;
      })
      .then((data) => {
        if (!data || disposed) return;
        setForm({
          phone: data.phone || "",
          address: data.address || "",
          lat: String(data.lat ?? ""),
          lon: String(data.lon ?? ""),
          tank_volume_m3: String(data.tank_volume_m3 ?? ""),
          service_price: String(data.service_price ?? ""),
        });
        setStatus(data.moderation_status || null);
        setComment(data.moderation_comment || null);
      })
      .catch((error) => !disposed && toast.error(error instanceof Error ? error.message : "Не удалось загрузить анкету"))
      .finally(() => !disposed && setLoading(false));
    return () => { disposed = true; };
  }, [token]);

  const update = (field: keyof SepticForm, value: string) => setForm((current) => ({ ...current, [field]: value }));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch(`${baseURL}/equipment-owner/septic-profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          phone: form.phone.trim(),
          address: form.address.trim(),
          lat: Number(form.lat),
          lon: Number(form.lon),
          tank_volume_m3: Number(form.tank_volume_m3),
          service_price: Number(form.service_price),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось сохранить анкету"));
      setStatus(data.moderation_status || "pending_moderation");
      setComment(data.moderation_comment || null);
      toast.success("Анкета сохранена и отправлена на модерацию.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить анкету");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loader2 className="mx-auto mt-20 h-8 w-8 animate-spin text-sky-500" />;

  return <div className="px-4 pb-24 pt-5">
    <div className="mb-5 flex items-center gap-3"><span className="rounded-2xl bg-cyan-100 p-3 text-cyan-600"><Droplets /></span><div><h1 className="text-xl font-black">Услуги по откачке септиков</h1><p className="text-sm text-slate-500">Только данные, нужные клиенту</p></div></div>
    {status ? <p className="mb-4 rounded-xl bg-slate-100 p-3 text-sm font-semibold text-slate-700">Статус: {status === "pending_moderation" ? "на модерации" : status === "approved" ? "одобрено" : "отклонено"}</p> : null}
    {comment ? <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{comment}</p> : null}
    <form onSubmit={save} className="space-y-4 rounded-3xl bg-white p-4 shadow-sm">
      <label className="block text-sm font-bold">Номер телефона <span className="text-red-500">*</span><span className="mt-1 flex items-center gap-2 rounded-xl border border-slate-200 px-3"><Phone className="h-4 w-4 text-slate-400" /><input required type="tel" value={form.phone} onChange={(event) => update("phone", event.target.value)} className="w-full py-3 outline-none" /></span></label>
      <label className="block text-sm font-bold">Адрес / точка на карте <span className="text-red-500">*</span><span className="mt-1 flex items-center gap-2 rounded-xl border border-slate-200 px-3"><MapPin className="h-4 w-4 text-slate-400" /><input required value={form.address} onChange={(event) => update("address", event.target.value)} className="w-full py-3 outline-none" /></span></label>
      <div className="grid grid-cols-2 gap-3"><label className="text-sm font-bold">Широта<input required type="number" step="any" min="-90" max="90" value={form.lat} onChange={(event) => update("lat", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3" /></label><label className="text-sm font-bold">Долгота<input required type="number" step="any" min="-180" max="180" value={form.lon} onChange={(event) => update("lon", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3" /></label></div>
      <label className="block text-sm font-bold">Объём цистерны, м³ <span className="text-red-500">*</span><input required type="number" min="0.1" step="0.1" value={form.tank_volume_m3} onChange={(event) => update("tank_volume_m3", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3" /></label>
      <label className="block text-sm font-bold">Стоимость услуги, ₽ <span className="text-red-500">*</span><span className="mt-1 flex items-center gap-2 rounded-xl border border-slate-200 px-3"><Wallet className="h-4 w-4 text-slate-400" /><input required type="number" min="1" step="1" value={form.service_price} onChange={(event) => update("service_price", event.target.value)} className="w-full py-3 outline-none" /></span></label>
      <button disabled={saving} className="flex w-full items-center justify-center rounded-xl bg-sky-500 py-3 font-bold text-white disabled:opacity-50">{saving ? <Loader2 className="animate-spin" /> : "Сохранить"}</button>
    </form>
  </div>;
}
