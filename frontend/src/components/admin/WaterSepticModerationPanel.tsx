import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  Archive,
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

import AddressMapPicker from "../AddressMapPicker";
import { baseURL, extractApiErrorMessage, resolveMediaUrl } from "../../utils";

type ManagementTab = "water" | "septic";
type StatusFilter = "all" | "pending_moderation" | "approved" | "suspended";

interface WaterPoint {
  id: string;
  water_type: "free" | "paid";
  name?: string | null;
  source: string;
  address: string;
  lat: number;
  lon: number;
  phone?: string | null;
  price?: number | string | null;
  price_unit?: string | null;
  description?: string | null;
  primary_image_url?: string | null;
  moderation_status: string;
  moderation_comment?: string | null;
  is_active: boolean;
}

interface SepticProfile {
  id: string;
  phone: string;
  address: string;
  lat: number;
  lon: number;
  tank_volume_m3: number | string;
  service_price: number | string;
  primary_image_url?: string | null;
  moderation_status: string;
  moderation_comment?: string | null;
  is_active: boolean;
}

interface RejectTarget {
  id: string;
  kind: ManagementTab;
  label: string;
}

interface EditTarget {
  kind: ManagementTab;
  data: WaterPoint | SepticProfile;
}

const statusLabel: Record<string, string> = {
  pending_moderation: "На модерации",
  approved: "Одобрено",
  rejected: "Отклонено",
  suspended: "В архиве",
};

const normalizeStatus = (status?: string | null) => status?.toLowerCase() || "";

const statusClass = (status?: string | null) => {
  switch (normalizeStatus(status)) {
    case "approved":
      return "bg-green-100 text-green-800";
    case "rejected":
      return "bg-red-100 text-red-800";
    case "suspended":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
};

const createWaterEditForm = (point: WaterPoint) => ({
  water_type: point.water_type === "paid" ? "paid" : "free",
  name: point.name || "",
  source: point.source || "",
  address: point.address || "",
  lat: String(point.lat ?? ""),
  lon: String(point.lon ?? ""),
  phone: point.phone || "",
  price: point.price == null ? "" : String(point.price),
  price_unit: point.price_unit || "литр",
  description: point.description || "",
});

const createSepticEditForm = (profile: SepticProfile) => ({
  phone: profile.phone || "",
  address: profile.address || "",
  lat: String(profile.lat ?? ""),
  lon: String(profile.lon ?? ""),
  tank_volume_m3: String(profile.tank_volume_m3 ?? ""),
  service_price: String(profile.service_price ?? ""),
});

export default function WaterSepticModerationPanel({ token }: { token: string | null }) {
  const [tab, setTab] = useState<ManagementTab>("water");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending_moderation");
  const [waterPoints, setWaterPoints] = useState<WaterPoint[]>([]);
  const [septicProfiles, setSepticProfiles] = useState<SepticProfile[]>([]);
  const [pendingWaterCount, setPendingWaterCount] = useState(0);
  const [pendingSepticCount, setPendingSepticCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<RejectTarget | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [waterEditForm, setWaterEditForm] = useState(() => createWaterEditForm({
    id: "", water_type: "free", source: "", address: "", lat: 0, lon: 0, moderation_status: "", is_active: true,
  }));
  const [septicEditForm, setSepticEditForm] = useState(() => createSepticEditForm({
    id: "", phone: "", address: "", lat: 0, lon: 0, tank_volume_m3: "", service_price: "", moderation_status: "", is_active: true,
  }));
  const initialFilterResolvedRef = useRef(false);

  const filteredItems = tab === "water" ? waterPoints : septicProfiles;

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const query = statusFilter === "all" ? "" : `?moderation_status=${statusFilter}`;
      const [waterResponse, septicResponse, countsResponse] = await Promise.all([
        fetch(`${baseURL}/admin/water-points${query}`, { headers }),
        fetch(`${baseURL}/admin/septic-providers${query}`, { headers }),
        fetch(`${baseURL}/admin/sidebar/counts`, { headers }),
      ]);
      const [waterData, septicData, countsData] = await Promise.all([
        waterResponse.json().catch(() => []),
        septicResponse.json().catch(() => []),
        countsResponse.json().catch(() => ({})),
      ]);
      if (!waterResponse.ok || !septicResponse.ok) {
        throw new Error(
          extractApiErrorMessage(
            !waterResponse.ok ? waterData : septicData,
            "Не удалось загрузить записи",
          ),
        );
      }

      const nextWaterPoints = Array.isArray(waterData) ? waterData : [];
      const nextSepticProfiles = Array.isArray(septicData) ? septicData : [];
      setWaterPoints(nextWaterPoints);
      setSepticProfiles(nextSepticProfiles);
      const nextPendingWaterCount = countsResponse.ok
        ? Number(countsData.water_points) || 0
        : statusFilter === "pending_moderation" ? nextWaterPoints.length : 0;
      const nextPendingSepticCount = countsResponse.ok
        ? Number(countsData.septic_profiles) || 0
        : statusFilter === "pending_moderation" ? nextSepticProfiles.length : 0;
      setPendingWaterCount(nextPendingWaterCount);
      setPendingSepticCount(nextPendingSepticCount);

      if (!initialFilterResolvedRef.current) {
        initialFilterResolvedRef.current = true;
        if (nextPendingWaterCount + nextPendingSepticCount === 0 && statusFilter === "pending_moderation") {
          setStatusFilter("all");
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить записи");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const requestAction = async (
    kind: ManagementTab,
    id: string,
    action: "approve" | "reject" | "suspend",
    reason?: string,
  ) => {
    if (!token) return;
    setActionId(id);
    try {
      const resource = kind === "water" ? "/admin/water-points" : "/admin/septic-providers";
      const query = action === "reject" ? `?reason=${encodeURIComponent(reason || "")}` : "";
      const response = await fetch(`${baseURL}${resource}/${id}/${action}${query}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data, "Не удалось обновить запись"));
      }
      setRejectTarget(null);
      setRejectReason("");
      toast.success(
        action === "approve"
          ? "Заявка одобрена"
          : action === "reject"
            ? "Заявка отклонена"
            : "Запись перенесена в архив",
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обновить запись");
    } finally {
      setActionId(null);
    }
  };

  const openReject = (kind: ManagementTab, id: string, label: string) => {
    setRejectReason("");
    setRejectTarget({ kind, id, label });
  };

  const openWaterEdit = (point: WaterPoint) => {
    setWaterEditForm(createWaterEditForm(point));
    setEditTarget({ kind: "water", data: point });
  };

  const openSepticEdit = (profile: SepticProfile) => {
    setSepticEditForm(createSepticEditForm(profile));
    setEditTarget({ kind: "septic", data: profile });
  };

  const submitEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || !editTarget) return;
    setActionId(editTarget.data.id);
    try {
      const isWater = editTarget.kind === "water";
      const resource = isWater ? "/admin/water-points" : "/admin/septic-providers";
      const payload = isWater
        ? {
            water_type: waterEditForm.water_type,
            name: waterEditForm.name.trim() || null,
            source: waterEditForm.source.trim(),
            address: waterEditForm.address.trim(),
            lat: Number(waterEditForm.lat),
            lon: Number(waterEditForm.lon),
            phone: waterEditForm.phone.trim() || null,
            price: waterEditForm.water_type === "paid" ? Number(waterEditForm.price) : null,
            price_unit: waterEditForm.water_type === "paid" ? waterEditForm.price_unit.trim() : null,
            description: waterEditForm.description.trim() || null,
          }
        : {
            phone: septicEditForm.phone.trim(),
            address: septicEditForm.address.trim(),
            lat: Number(septicEditForm.lat),
            lon: Number(septicEditForm.lon),
            tank_volume_m3: Number(septicEditForm.tank_volume_m3),
            service_price: Number(septicEditForm.service_price),
          };
      const response = await fetch(`${baseURL}${resource}/${editTarget.data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось сохранить изменения"));
      setEditTarget(null);
      toast.success("Изменения сохранены");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить изменения");
    } finally {
      setActionId(null);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Вода и септики</h2>
          <p className="mt-1 text-sm text-slate-500">Управление точками воды и профилями септиков</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Обновить
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Тип записей">
        <button type="button" role="tab" aria-selected={tab === "water"} onClick={() => setTab("water")} className={`rounded-lg px-3 py-2 text-sm font-bold transition-colors ${tab === "water" ? "bg-white text-sky-600 shadow-sm" : "text-slate-500"}`}>
          <span className="inline-flex items-center">Точки воды{pendingWaterCount > 0 ? <span className="ml-2 rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">{pendingWaterCount}</span> : null}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "septic"} onClick={() => setTab("septic")} className={`rounded-lg px-3 py-2 text-sm font-bold transition-colors ${tab === "septic" ? "bg-white text-sky-600 shadow-sm" : "text-slate-500"}`}>
          <span className="inline-flex items-center">Септики{pendingSepticCount > 0 ? <span className="ml-2 rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">{pendingSepticCount}</span> : null}</span>
        </button>
      </div>

      <label className="mt-4 block text-sm font-bold text-slate-700">
        Статус
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 font-normal outline-none focus:border-sky-400">
          <option value="all">Все статусы</option>
          <option value="pending_moderation">На модерации</option>
          <option value="approved">Активные (одобрено)</option>
          <option value="suspended">Архив / скрыто</option>
        </select>
      </label>

      {loading ? <div className="flex justify-center py-10"><Loader2 className="h-8 w-8 animate-spin text-sky-500" /></div> : filteredItems.length === 0 ? <p className="mt-4 rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">По выбранному фильтру записей нет.</p> : <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {tab === "water" ? waterPoints.map((point) => {
          const status = normalizeStatus(point.moderation_status);
          const isPending = status === "pending_moderation";
          const isApproved = status === "approved";
          return <article key={point.id} className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
            {point.primary_image_url ? <img src={resolveMediaUrl(point.primary_image_url)} alt={point.name || point.source} className="h-40 w-full object-cover" /> : null}
            <div className="space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">{point.name || point.source}</h3><p className="text-sm text-slate-500">Источник: {point.source}</p></div><div className="flex flex-col items-end gap-1"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(status)}`}>{statusLabel[status] || point.moderation_status}</span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${point.water_type === "free" ? "bg-blue-100 text-blue-800" : "bg-green-100 text-green-800"}`}>{point.water_type === "free" ? "Бесплатная" : "Платная"}</span></div></div><p className="flex gap-2 text-sm text-slate-600"><MapPin className="h-4 w-4 shrink-0" />{point.address}</p>{point.phone ? <p className="flex gap-2 text-sm text-slate-600"><Phone className="h-4 w-4 shrink-0" />{point.phone}</p> : null}{point.description ? <p className="text-sm text-slate-600">{point.description}</p> : null}{point.water_type === "paid" && point.price != null && point.price_unit ? <p className="text-right text-lg font-black text-slate-900">{Number(point.price).toLocaleString("ru-RU")} ₽/{point.price_unit}</p> : null}{point.moderation_comment ? <p className="rounded-xl bg-red-50 p-2 text-sm text-red-700">{point.moderation_comment}</p> : null}{isPending ? <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3"><button type="button" disabled={actionId === point.id} onClick={() => openReject("water", point.id, point.name || point.source)} className="flex items-center justify-center gap-2 rounded-xl border border-rose-200 py-2.5 text-sm font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50"><XCircle className="h-4 w-4" />Отклонить</button><button type="button" disabled={actionId === point.id} onClick={() => void requestAction("water", point.id, "approve")} className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-50">{actionId === point.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Одобрить</button></div> : isApproved ? <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3"><button type="button" onClick={() => openWaterEdit(point)} className="flex items-center justify-center rounded-xl bg-slate-100 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-200">Редактировать</button><button type="button" disabled={actionId === point.id} onClick={() => void requestAction("water", point.id, "suspend")} className="flex items-center justify-center gap-2 rounded-xl border border-amber-200 py-2.5 text-sm font-bold text-amber-700 hover:bg-amber-50 disabled:opacity-50"><Archive className="h-4 w-4" />В архив</button></div> : null}</div>
          </article>;
        }) : septicProfiles.map((profile) => {
          const status = normalizeStatus(profile.moderation_status);
          const isPending = status === "pending_moderation";
          const isApproved = status === "approved";
          return <article key={profile.id} className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
            {profile.primary_image_url ? <img src={resolveMediaUrl(profile.primary_image_url)} alt={profile.address} className="h-40 w-full object-cover" /> : null}
            <div className="space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="rounded-xl bg-cyan-100 p-2.5 text-cyan-600"><Truck className="h-5 w-5" /></span><div><h3 className="font-bold text-slate-900">Откачка септика</h3><p className="mt-1 flex gap-2 text-sm text-slate-600"><Phone className="h-4 w-4 shrink-0" />{profile.phone}</p></div></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(status)}`}>{statusLabel[status] || profile.moderation_status}</span></div><p className="flex gap-2 text-sm text-slate-600"><MapPin className="h-4 w-4 shrink-0" />{profile.address}</p><div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-sm"><p><span className="block text-xs text-slate-400">Цистерна</span><strong>{profile.tank_volume_m3} м³</strong></p><p><span className="block text-xs text-slate-400">Цена услуги</span><strong>{Number(profile.service_price).toLocaleString("ru-RU")} ₽</strong></p></div>{profile.moderation_comment ? <p className="rounded-xl bg-red-50 p-2 text-sm text-red-700">{profile.moderation_comment}</p> : null}{isPending ? <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3"><button type="button" disabled={actionId === profile.id} onClick={() => openReject("septic", profile.id, "Профиль септика")} className="flex items-center justify-center gap-2 rounded-xl border border-rose-200 py-2.5 text-sm font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50"><XCircle className="h-4 w-4" />Отклонить</button><button type="button" disabled={actionId === profile.id} onClick={() => void requestAction("septic", profile.id, "approve")} className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-50">{actionId === profile.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Одобрить</button></div> : isApproved ? <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3"><button type="button" onClick={() => openSepticEdit(profile)} className="flex items-center justify-center rounded-xl bg-slate-100 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-200">Редактировать</button><button type="button" disabled={actionId === profile.id} onClick={() => void requestAction("septic", profile.id, "suspend")} className="flex items-center justify-center gap-2 rounded-xl border border-amber-200 py-2.5 text-sm font-bold text-amber-700 hover:bg-amber-50 disabled:opacity-50"><Archive className="h-4 w-4" />В архив</button></div> : null}</div>
          </article>;
        })}
      </div>}

      {rejectTarget ? <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" role="dialog" aria-modal="true"><div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-black text-slate-900">Отклонить заявку?</h3><p className="mt-1 text-sm text-slate-500">{rejectTarget.label}</p></div><button type="button" onClick={() => setRejectTarget(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100" aria-label="Закрыть"><X className="h-5 w-5" /></button></div><label className="mt-4 block text-sm font-bold text-slate-700">Причина отклонения<textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} className="mt-1 min-h-24 w-full rounded-xl border border-slate-200 p-3 font-normal outline-none focus:border-sky-400" placeholder="Опишите, что нужно исправить" /></label><div className="mt-5 grid grid-cols-2 gap-3"><button type="button" onClick={() => setRejectTarget(null)} className="rounded-xl bg-slate-100 py-3 font-bold text-slate-700">Отмена</button><button type="button" disabled={!rejectReason.trim() || actionId === rejectTarget.id} onClick={() => void requestAction(rejectTarget.kind, rejectTarget.id, "reject", rejectReason)} className="rounded-xl bg-rose-500 py-3 font-bold text-white disabled:opacity-50">Отклонить</button></div></div></div> : null}

      {editTarget ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" role="dialog" aria-modal="true">
          <form onSubmit={submitEdit} className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-lg font-black text-slate-900">
                {editTarget.kind === "water" ? "Редактирование точки воды" : "Редактирование септика"}
              </h3>
              <button type="button" onClick={() => setEditTarget(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100" aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </div>

            {editTarget.kind === "water" ? (
              <div className="mt-4 space-y-3">
                <label className="block text-sm font-bold">Тип воды
                  <select value={waterEditForm.water_type} onChange={(event) => setWaterEditForm((current) => ({ ...current, water_type: event.target.value as "free" | "paid" }))} className="mt-1 w-full rounded-xl border border-slate-200 p-3 font-normal">
                    <option value="free">Бесплатная</option>
                    <option value="paid">Платная</option>
                  </select>
                </label>
                <label className="block text-sm font-bold">Название
                  <input value={waterEditForm.name} onChange={(event) => setWaterEditForm((current) => ({ ...current, name: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 p-3 font-normal" />
                </label>
                <label className="block text-sm font-bold">Источник
                  <input required value={waterEditForm.source} onChange={(event) => setWaterEditForm((current) => ({ ...current, source: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 p-3 font-normal" />
                </label>
                <AddressMapPicker
                  token={token}
                  inputId="admin-water-address"
                  address={waterEditForm.address}
                  lat={waterEditForm.lat}
                  lon={waterEditForm.lon}
                  onChange={(location) => setWaterEditForm((current) => ({ ...current, ...location }))}
                />
                <label className="block text-sm font-bold">Телефон
                  <input value={waterEditForm.phone} onChange={(event) => setWaterEditForm((current) => ({ ...current, phone: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 p-3 font-normal" />
                </label>
                {waterEditForm.water_type === "paid" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-sm font-bold">Цена
                      <input required type="number" min="0.01" step="0.01" value={waterEditForm.price} onChange={(event) => setWaterEditForm((current) => ({ ...current, price: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 p-3 font-normal" />
                    </label>
                    <label className="text-sm font-bold">Единица
                      <input required value={waterEditForm.price_unit} onChange={(event) => setWaterEditForm((current) => ({ ...current, price_unit: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 p-3 font-normal" />
                    </label>
                  </div>
                ) : null}
                <label className="block text-sm font-bold">Описание
                  <textarea value={waterEditForm.description} onChange={(event) => setWaterEditForm((current) => ({ ...current, description: event.target.value }))} className="mt-1 min-h-20 w-full rounded-xl border border-slate-200 p-3 font-normal" />
                </label>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <label className="block text-sm font-bold">Телефон
                  <input required value={septicEditForm.phone} onChange={(event) => setSepticEditForm((current) => ({ ...current, phone: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 p-3 font-normal" />
                </label>
                <AddressMapPicker
                  token={token}
                  inputId="admin-septic-address"
                  address={septicEditForm.address}
                  lat={septicEditForm.lat}
                  lon={septicEditForm.lon}
                  onChange={(location) => setSepticEditForm((current) => ({ ...current, ...location }))}
                />
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm font-bold">Объём, м³
                    <input required type="number" min="0.1" step="0.1" value={septicEditForm.tank_volume_m3} onChange={(event) => setSepticEditForm((current) => ({ ...current, tank_volume_m3: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 p-3 font-normal" />
                  </label>
                  <label className="text-sm font-bold">Стоимость, ₽
                    <input required type="number" min="1" step="1" value={septicEditForm.service_price} onChange={(event) => setSepticEditForm((current) => ({ ...current, service_price: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 p-3 font-normal" />
                  </label>
                </div>
              </div>
            )}

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setEditTarget(null)} className="rounded-xl bg-slate-100 py-3 font-bold text-slate-700">Отмена</button>
              <button disabled={actionId === editTarget.data.id} className="flex items-center justify-center rounded-xl bg-sky-500 py-3 font-bold text-white disabled:opacity-50">
                {actionId === editTarget.data.id ? <Loader2 className="h-5 w-5 animate-spin" /> : "Сохранить"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
