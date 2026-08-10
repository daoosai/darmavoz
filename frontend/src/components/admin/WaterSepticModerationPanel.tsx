import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  MapPin,
  Phone,
  RefreshCw,
  Truck,
  X,
  XCircle,
} from "lucide-react";
import toast from "react-hot-toast";

import { baseURL, extractApiErrorMessage, resolveMediaUrl } from "../../utils";

type ModerationTab = "water" | "septic";

interface WaterPoint {
  id: string;
  water_type: "free" | "paid";
  name?: string | null;
  source: string;
  address: string;
  phone?: string | null;
  price?: number | string | null;
  price_unit?: string | null;
  description?: string | null;
  primary_image_url?: string | null;
}

interface SepticProfile {
  id: string;
  phone: string;
  address: string;
  tank_volume_m3: number | string;
  service_price: number | string;
  primary_image_url?: string | null;
}

interface RejectTarget {
  id: string;
  label: string;
}

export default function WaterSepticModerationPanel({ token }: { token: string | null }) {
  const [tab, setTab] = useState<ModerationTab>("water");
  const [waterPoints, setWaterPoints] = useState<WaterPoint[]>([]);
  const [septicProfiles, setSepticProfiles] = useState<SepticProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<RejectTarget | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const basePath = tab === "water" ? "/admin/water-points" : "/admin/septic-providers";
  const items = tab === "water" ? waterPoints : septicProfiles;

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await fetch(
        `${baseURL}${basePath}?moderation_status=pending_moderation`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await response.json().catch(() => []);
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data, "Не удалось загрузить заявки"));
      }
      if (tab === "water") {
        setWaterPoints(Array.isArray(data) ? data : []);
      } else {
        setSepticProfiles(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить заявки");
    } finally {
      setLoading(false);
    }
  }, [basePath, tab, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const moderate = async (id: string, action: "approve" | "reject", reason?: string) => {
    if (!token) return;
    setActionId(id);
    try {
      const query = action === "reject" ? `?reason=${encodeURIComponent(reason || "")}` : "";
      const response = await fetch(`${baseURL}${basePath}/${id}/${action}${query}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data, "Не удалось обновить статус"));
      }
      toast.success(action === "approve" ? "Заявка одобрена" : "Заявка отклонена");
      setRejectTarget(null);
      setRejectReason("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обновить статус");
    } finally {
      setActionId(null);
    }
  };

  const openReject = (id: string, label: string) => {
    setRejectReason("");
    setRejectTarget({ id, label });
  };

  return (
    <section className="mt-6 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Вода и септики</h2>
          <p className="mt-1 text-sm text-slate-500">Заявки поставщиков, ожидающие модерации</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Обновить
        </button>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Тип заявок на модерацию">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "water"}
          onClick={() => setTab("water")}
          className={`rounded-lg px-3 py-2 text-sm font-bold transition-colors ${tab === "water" ? "bg-white text-sky-600 shadow-sm" : "text-slate-500"}`}
        >
          Точки воды
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "septic"}
          onClick={() => setTab("septic")}
          className={`rounded-lg px-3 py-2 text-sm font-bold transition-colors ${tab === "septic" ? "bg-white text-sky-600 shadow-sm" : "text-slate-500"}`}
        >
          Септики
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-8 w-8 animate-spin text-sky-500" /></div>
      ) : items.length === 0 ? (
        <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">Нет заявок, ожидающих модерации.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {tab === "water"
            ? waterPoints.map((point) => (
                <article key={point.id} className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
                  {point.primary_image_url ? <img src={resolveMediaUrl(point.primary_image_url)} alt={point.name || point.source} className="h-40 w-full object-cover" /> : null}
                  <div className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-bold text-slate-900">{point.name || point.source}</h3>
                        <p className="text-sm text-slate-500">Источник: {point.source}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${point.water_type === "free" ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"}`}>
                        {point.water_type === "free" ? "Бесплатно" : `${Number(point.price).toLocaleString("ru-RU")} ₽/${point.price_unit}`}
                      </span>
                    </div>
                    <p className="flex gap-2 text-sm text-slate-600"><MapPin className="h-4 w-4 shrink-0" />{point.address}</p>
                    {point.phone ? <p className="flex gap-2 text-sm text-slate-600"><Phone className="h-4 w-4 shrink-0" />{point.phone}</p> : null}
                    {point.description ? <p className="text-sm text-slate-600">{point.description}</p> : null}
                    <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
                      <button type="button" disabled={actionId === point.id} onClick={() => openReject(point.id, point.name || point.source)} className="flex items-center justify-center gap-2 rounded-xl border border-rose-200 py-2.5 text-sm font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50"><XCircle className="h-4 w-4" />Отклонить</button>
                      <button type="button" disabled={actionId === point.id} onClick={() => void moderate(point.id, "approve")} className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-50">{actionId === point.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Одобрить</button>
                    </div>
                  </div>
                </article>
              ))
            : septicProfiles.map((profile) => (
                <article key={profile.id} className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
                  {profile.primary_image_url ? <img src={resolveMediaUrl(profile.primary_image_url)} alt={profile.address} className="h-40 w-full object-cover" /> : null}
                  <div className="p-4">
                  <div className="flex items-start gap-3">
                    <span className="rounded-xl bg-cyan-100 p-2.5 text-cyan-600"><Truck className="h-5 w-5" /></span>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-bold text-slate-900">Услуги откачки септиков</h3>
                      <p className="mt-1 flex gap-2 text-sm text-slate-600"><Phone className="h-4 w-4 shrink-0" />{profile.phone}</p>
                    </div>
                  </div>
                  <p className="mt-4 flex gap-2 text-sm text-slate-600"><MapPin className="h-4 w-4 shrink-0" />{profile.address}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-sm"><p><span className="block text-xs text-slate-400">Цистерна</span><strong>{profile.tank_volume_m3} м³</strong></p><p><span className="block text-xs text-slate-400">Цена услуги</span><strong>{Number(profile.service_price).toLocaleString("ru-RU")} ₽</strong></p></div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button type="button" disabled={actionId === profile.id} onClick={() => openReject(profile.id, "анкета септика")} className="flex items-center justify-center gap-2 rounded-xl border border-rose-200 py-2.5 text-sm font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50"><XCircle className="h-4 w-4" />Отклонить</button>
                    <button type="button" disabled={actionId === profile.id} onClick={() => void moderate(profile.id, "approve")} className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-50">{actionId === profile.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Одобрить</button>
                  </div>
                  </div>
                </article>
              ))}
        </div>
      )}

      {rejectTarget ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Отклонение заявки">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-black text-slate-900">Отклонить заявку?</h3><p className="mt-1 text-sm text-slate-500">{rejectTarget.label}</p></div><button type="button" onClick={() => setRejectTarget(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100" aria-label="Закрыть"><X className="h-5 w-5" /></button></div>
            <label className="mt-4 block text-sm font-bold text-slate-700">Причина отклонения<textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} className="mt-1 min-h-24 w-full rounded-xl border border-slate-200 p-3 font-normal outline-none focus:border-sky-400" placeholder="Опишите, что нужно исправить" /></label>
            <div className="mt-5 grid grid-cols-2 gap-3"><button type="button" onClick={() => setRejectTarget(null)} className="rounded-xl bg-slate-100 py-3 font-bold text-slate-700">Отмена</button><button type="button" disabled={!rejectReason.trim() || actionId === rejectTarget.id} onClick={() => void moderate(rejectTarget.id, "reject", rejectReason)} className="rounded-xl bg-rose-500 py-3 font-bold text-white disabled:opacity-50">{actionId === rejectTarget.id ? "Сохраняем…" : "Отклонить"}</button></div>
          </div>
        </div>
      ) : null}

    </section>
  );
}
