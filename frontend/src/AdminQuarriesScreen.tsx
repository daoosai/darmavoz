import React, { useState, useEffect } from "react";
import { Plus, Edit2, ImagePlus, Star, Trash2, Crown } from "lucide-react";
import toast from "react-hot-toast";
import {
  fetch2gisAddressSuggestions,
  get2gisSuggestionAddress,
  get2gisSuggestionCoordinates,
  get2gisSuggestionLabel,
  withTyumenBias,
} from "./addressSearch";
import { useAuthStore, usePlacementStore } from "./store";
import { baseURL, extractApiErrorMessage, formatPhoneNumber } from "./utils";
import { PlacementBadge, PlacementDates, type PlacementFields, type PlacementStatus } from "./placement";
import MapWebGLFallback, { tryCreate2GisMap } from "./components/MapWebGLFallback";

export interface Quarry extends PlacementFields {
  id?: string;
  name: string;
  short_name?: string;
  point_type: "quarry" | "accumulator" | "warehouse" | "supplier";
  address: string;
  description?: string;
  contact_phone?: string | null;
  subscription_end_date?: string | null;
  lat: number | null;
  lon: number | null;
  min_delivery_price?: number;
  is_vip?: boolean;
  manual_priority?: number;
  moderation_status?: string;
  pending_changes?: Record<string, unknown> | null;
  is_active: boolean;
  owner_user_id?: string | null;
  material_ids?: string[];
  material_offers?: { material_id: string; price: number; is_active: boolean }[];
  delivery_option_ids?: string[];
  materials?: any[];
  owner_name?: string | null;
  owner_phone?: string | null;
  primary_image_url?: string | null;
  media_files?: {
    id: string;
    public_url: string;
    file_name?: string;
    is_primary?: boolean;
  }[];
}

const getQuarryAddress = (quarry: Quarry) =>
  quarry.address?.trim() ||
  (quarry.lat && quarry.lon
    ? `По координатам: ${quarry.lat}, ${quarry.lon}`
    : "Адрес не указан");

const MODERATION_BADGES: Record<string, { label: string; className: string }> = {
  incomplete: { label: "Черновик", className: "bg-slate-100 text-slate-600" },
  pending_moderation: { label: "На модерации", className: "bg-amber-100 text-amber-800" },
  approved: { label: "Одобрен", className: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "Отклонен", className: "bg-rose-100 text-rose-700" },
  suspended: { label: "Приостановлен", className: "bg-orange-100 text-orange-700" },
};

MODERATION_BADGES.has_pending_changes = {
  label: "Есть правки",
  className: "bg-sky-100 text-sky-800",
};

const moderationBadge = (status?: string) =>
  MODERATION_BADGES[status || "incomplete"] || MODERATION_BADGES.incomplete;

const normalizeManualPriority = (value?: number | null) => {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(100, Math.max(0, Math.trunc(parsed)));
};

const POINT_TYPE_LABELS: Record<Quarry["point_type"], string> = {
  quarry: "Карьер",
  accumulator: "Накопитель",
  warehouse: "Склад",
  supplier: "Поставщик",
};

type EditablePointType = "quarry" | "accumulator";

const normalizeEditablePointType = (value?: Quarry["point_type"]): EditablePointType =>
  value === "accumulator" ? "accumulator" : "quarry";

const normalizeDateInputValue = (value?: unknown) => {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }

  const parsed = parseSubscriptionEndDate(value);
  return parsed ? parsed.toISOString().split("T")[0] : "";
};

const parseSubscriptionEndDate = (value?: unknown) => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  if (!normalized) return null;

  const dottedMatch = normalized.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dottedMatch) {
    const [, day, month, year] = dottedMatch;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  }

  const isoDateMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateMatch) {
    const [, year, month, day] = isoDateMatch;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const serializeSubscriptionEndDate = (value?: string | null) => {
  const parsed = parseSubscriptionEndDate(value);
  return parsed ? parsed.toISOString() : null;
};

const subscriptionDateInputMin = new Date().toISOString().split("T")[0];

const normalizeSubscriptionDateInput = (value: string) => {
  if (!value) return "";
  const truncated = value.slice(0, 10);
  const [year = "", month = "", day = ""] = truncated.split("-");
  return [year.slice(0, 4), month.slice(0, 2), day.slice(0, 2)]
    .filter((part, index, parts) => part || parts.slice(index + 1).some(Boolean))
    .join("-");
};

const normalizeOptionalText = (value?: string | null) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
};

type QuarryMediaFile = NonNullable<Quarry["media_files"]>[number];

type QuarryFormData = Omit<Quarry, "lat" | "lon" | "media_files"> & {
  lat: string;
  lon: string;
  media_files: QuarryMediaFile[];
};

type AddressSuggestion = {
  label: string;
  address: string;
  lat?: number;
  lon?: number;
};

const stringifyCoordinate = (value?: number | null) =>
  typeof value === "number" && Number.isFinite(value) ? String(value) : "";

const parseCoordinate = (value?: string | number | null) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildQuarryFormData = (quarry: Quarry): QuarryFormData => ({
  ...quarry,
  point_type: normalizeEditablePointType(quarry.point_type),
  contact_phone: quarry.contact_phone || quarry.owner_phone || "",
  subscription_end_date: normalizeDateInputValue(quarry.subscription_end_date),
  lat: stringifyCoordinate(quarry.lat),
  lon: stringifyCoordinate(quarry.lon),
  media_files: quarry.media_files || [],
});

interface AdminQuarriesScreenProps {
  materials: any[];
  onPointsChanged?: () => void | Promise<void>;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  placementFilter: PlacementStatus | "";
  onPlacementFilterChange: (value: PlacementStatus | "") => void;
  typeFilter: string;
  onTypeFilterChange: (value: string) => void;
}

const ALLOWED_POINT_TYPES = new Set(["quarry", "accumulator", "warehouse", "supplier"]);
const ALLOWED_MODERATION_FILTERS = new Set([
  "",
  "pending_moderation",
  "approved",
  "rejected",
  "suspended",
  "has_pending_changes",
]);
const ALLOWED_PLACEMENT_FILTERS = new Set<PlacementStatus | "">([
  "",
  "active",
  "trial",
  "confirmation_required",
  "hidden",
  "expired",
  "archived",
  "pending_moderation",
]);

export default function AdminQuarriesScreen({
  materials,
  onPointsChanged,
  statusFilter,
  onStatusFilterChange,
  placementFilter,
  onPlacementFilterChange,
  typeFilter,
  onTypeFilterChange,
}: AdminQuarriesScreenProps) {
  const { token } = useAuthStore();
  const [quarries, setQuarries] = useState<Quarry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingQuarry, setEditingQuarry] = useState<Quarry | null>(null);
  const [isModerating, setIsModerating] = useState(false);
  const [deletingPointId, setDeletingPointId] = useState<string | null>(null);
  const [rejectPointId, setRejectPointId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const { policy, loadPolicy, loadSummary } = usePlacementStore();
  const normalizedStatusFilter = ALLOWED_MODERATION_FILTERS.has(statusFilter)
    ? statusFilter
    : "";
  const normalizedPlacementFilter = ALLOWED_PLACEMENT_FILTERS.has(placementFilter)
    ? placementFilter
    : "";
  const normalizedTypeFilter = ALLOWED_POINT_TYPES.has(typeFilter)
    ? typeFilter
    : "";

  const fetchQuarries = async () => {
    if (!token) {
      return;
    }
    try {
      setIsLoading(true);
      const params = new URLSearchParams();
      if (normalizedStatusFilter) {
        params.set("moderation_status", normalizedStatusFilter);
      }
      if (normalizedPlacementFilter) {
        params.set("placement_status", normalizedPlacementFilter);
      }
      if (normalizedTypeFilter) {
        params.set("point_type", normalizedTypeFilter);
      }
      const query = params.toString();
      const requestUrl = query
        ? `${baseURL}/admin/pickup-points?${query}`
        : `${baseURL}/admin/pickup-points`;
      const res = await fetch(requestUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          extractApiErrorMessage(data, "Не удалось загрузить список точек"),
        );
      }
      const data = await res.json().catch(() => []);
      const loadedPoints = Array.isArray(data)
        ? data
        : Array.isArray((data as { items?: unknown[] }).items)
          ? (data as { items: Quarry[] }).items
          : Array.isArray((data as { results?: unknown[] }).results)
            ? (data as { results: Quarry[] }).results
            : [];
      setQuarries(loadedPoints);
    } catch (e) {
      console.error("Error fetching quarries", e);
      setQuarries([]);
      toast.error(
        e instanceof Error ? e.message : "Не удалось загрузить список точек",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!token) {
      return;
    }
    fetchQuarries();
  }, [token, normalizedStatusFilter, normalizedPlacementFilter, normalizedTypeFilter]);

  useEffect(() => {
    if (!policy) void loadPolicy();
  }, [loadPolicy, policy]);

  const placementAction = async (point: Quarry, action: "extend" | "hide" | "restore" | "archive") => {
    if (!point.id) return;
    const response = await fetch(`${baseURL}/admin/pickup-points/${point.id}/placement/${action}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      toast.error(extractApiErrorMessage(data, "Не удалось изменить размещение"));
      return;
    }
    toast.success(action === "extend" ? `Размещение продлено на ${policy?.extension_days ?? "установленный срок"} дней` : "Статус размещения обновлён");
    await fetchQuarries();
    if (token) await loadSummary(token);
  };

  const moderatePoint = async (
    pointId: string,
    action: "approve" | "reject",
    reason?: string,
  ) => {
    const point = quarries.find((item) => item.id === pointId);
    if (action === "approve" && (point?.lat == null || point?.lon == null)) {
      toast.error("Укажите координаты на карте перед одобрением");
      return false;
    }
    setIsModerating(true);
    try {
      const response = await fetch(`${baseURL}/admin/pickup-points/${pointId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(action === "reject" ? { reason } : { comment: null }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(typeof data.detail === "string" ? data.detail : "Не удалось изменить статус");
        return false;
      }
      toast.success(action === "approve" ? "Точка одобрена" : "Заявка отклонена");
      await fetchQuarries();
      await onPointsChanged?.();
      return true;
    } catch {
      toast.error("Не удалось связаться с сервером");
      return false;
    } finally {
      setIsModerating(false);
    }
  };

  const rejectPoint = (pointId: string) => {
    setRejectPointId(pointId);
    setRejectReason("");
  };

  const closeRejectModal = () => {
    if (isModerating) return;
    setRejectPointId(null);
    setRejectReason("");
  };

  const submitRejectPoint = async () => {
    if (!rejectPointId || !rejectReason.trim()) return;
    const success = await moderatePoint(rejectPointId, "reject", rejectReason.trim());
    if (success) {
      closeRejectModal();
    }
  };

  const deletePoint = async (point: Quarry) => {
    if (!point.id) return;
    if (!window.confirm("Удалить эту точку забора?")) return;
    setDeletingPointId(point.id);
    try {
      const response = await fetch(`${baseURL}/admin/pickup-points/${point.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(extractApiErrorMessage(data, "Не удалось удалить точку"));
        return;
      }
      toast.success(
        data.action === "deleted"
          ? "Точка удалена"
          : "Точка скрыта, так как уже связана с заказами",
      );
      await fetchQuarries();
      await onPointsChanged?.();
    } catch {
      toast.error("Не удалось связаться с сервером");
    } finally {
      setDeletingPointId(null);
    }
  };

  const handleOpenModal = (quarry?: Quarry) => {
    if (quarry) {
      setEditingQuarry(quarry);
    } else {
      setEditingQuarry({
        name: "",
        point_type: "quarry",
        address: "",
        description: "",
        contact_phone: "",
        subscription_end_date: "",
        lat: 57.152223,
        lon: 65.527202,
        is_vip: false,
        manual_priority: 0,
        is_active: false,
        material_ids: [],
        material_offers: [],
        media_files: [],
      });
    }
    setIsModalOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-[#2DB0E6] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-[calc(6rem+env(safe-area-inset-bottom,0px))]">
      <div className="flex justify-between items-center bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Точки</h2>
            <p className="text-sm text-slate-500">
              Управление точками погрузки
            </p>
          </div>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="bg-[#2DB0E6] text-white px-4 py-2 rounded-xl font-bold hover:bg-[#209BD6] transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Добавить
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 bg-white p-3 rounded-2xl border border-slate-100">
        <select value={normalizedStatusFilter} onChange={(event) => onStatusFilterChange(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
          <option value="">Все статусы</option>
          <option value="pending_moderation">На модерации</option>
          <option value="approved">Одобрено</option>
          <option value="rejected">Отклонено</option>
          <option value="suspended">Приостановлено</option>
          <option value="has_pending_changes">Есть правки</option>
        </select>
        <select value={normalizedPlacementFilter} onChange={(event) => onPlacementFilterChange(event.target.value as PlacementStatus | "")} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
          <option value="">Все размещения</option>
          <option value="active">Активные</option>
          <option value="trial">Тестовый период</option>
          <option value="confirmation_required">Требуют подтверждения</option>
          <option value="hidden">Скрытые</option>
          <option value="expired">Завершённые</option>
          <option value="archived">Архив</option>
        </select>
        <select value={normalizedTypeFilter} onChange={(event) => onTypeFilterChange(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
          <option value="">Все типы</option>
          <option value="quarry">Карьеры</option>
          <option value="accumulator">Накопители</option>
          <option value="warehouse">Склады</option>
          <option value="supplier">Поставщики</option>
        </select>
      </div>

      {/* Desktop View */}
      <div className="hidden overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm md:block">
        <div className="w-full">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider font-bold">
                <th className="p-4 border-b border-slate-100">Тип</th>
                <th className="p-4 border-b border-slate-100">Название</th>
                <th className="p-4 border-b border-slate-100">Адрес</th>
                <th className="p-4 border-b border-slate-100">Статус</th>
                <th className="p-4 border-b border-slate-100">Модерация</th>
                <th className="w-[340px] min-w-[340px] whitespace-nowrap border-b border-slate-100 p-4 pr-6">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {quarries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    Нет точек
                  </td>
                </tr>
              ) : (
                quarries.map((quarry) => (
                  <tr
                    key={quarry.id}
                    className="hover:bg-slate-50/50 transition-colors"
                  >
                    <td className="p-4">
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                        {POINT_TYPE_LABELS[quarry.point_type] || quarry.point_type}
                      </span>
                    </td>
                    <td className="p-4 text-slate-800">
                      <div className="font-bold">{quarry.name}</div>
                      {(quarry.owner_name || quarry.owner_phone) && (
                        <div className="mt-1 text-xs font-medium text-slate-500">
                          Владелец: {quarry.owner_name || "Имя не указано"}
                          {quarry.owner_phone ? `, ${quarry.owner_phone}` : ""}
                        </div>
                      )}
                    </td>
                    <td className="p-4 text-sm text-slate-600 max-w-[250px] truncate">
                      {getQuarryAddress(quarry)}
                    </td>
                    <td className="p-4">
                      <div className="mb-2 flex flex-wrap gap-1">
                        <PlacementBadge status={quarry.placement_status} />
                        
                        {quarry.is_vip ? (
                          <span className="inline-flex items-center gap-1 rounded-lg bg-amber-100 px-2 py-1 text-xs font-black uppercase tracking-wide text-amber-800">
                            <Crown className="h-3.5 w-3.5" />
                            VIP
                          </span>
                        ) : null}
                        {(quarry.manual_priority || 0) > 0 ? (
                          <span className="inline-flex items-center rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
                            #{quarry.manual_priority}
                          </span>
                        ) : null}
                      </div>
                      <PlacementDates item={quarry} />
                    </td>
                    <td className="p-4">
                      <span className={`inline-flex items-center rounded-lg px-2 py-1 text-xs font-bold ${moderationBadge(quarry.moderation_status).className}`}>
                        {moderationBadge(quarry.moderation_status).label}
                      </span>
                    </td>
                    <td className="w-[340px] min-w-[340px] align-top p-4 pr-6">
                      <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
                        <button
                          onClick={() => handleOpenModal(quarry)}
                          className="p-2 text-slate-400 hover:text-[#2DB0E6] hover:bg-[#2DB0E6]/10 rounded-xl transition-all"
                        >
                          <Edit2 className="w-5 h-5" />
                        </button>
                        {quarry.placement_status !== "archived" ? <button type="button" onClick={() => void placementAction(quarry, "extend")} className="rounded-xl bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700">Продлить</button> : null}
                        {quarry.placement_status === "hidden" || quarry.placement_status === "archived" ? <button type="button" onClick={() => void placementAction(quarry, "restore")} className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">Восстановить</button> : <button type="button" onClick={() => void placementAction(quarry, "hide")} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">Скрыть</button>}
                        {quarry.placement_status !== "archived" ? <button type="button" onClick={() => void placementAction(quarry, "archive")} className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-700">В архив</button> : null}
                        <button
                          type="button"
                          disabled={deletingPointId === quarry.id}
                          onClick={() => void deletePoint(quarry)}
                          className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all disabled:opacity-50"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                        {["pending_moderation", "has_pending_changes"].includes(quarry.moderation_status || "") && quarry.id && (
                          <div className="flex max-w-full flex-wrap items-center justify-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
                            <button disabled={isModerating} onClick={() => void moderatePoint(quarry.id!, "approve")} className="w-28 shrink-0 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">Одобрить</button>
                            <button disabled={isModerating} onClick={() => rejectPoint(quarry.id!)} className="w-28 shrink-0 rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50">Отклонить</button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile View */}
      <div className="flex flex-col gap-4 md:hidden">
        {quarries.length === 0 ? (
          <div className="p-8 text-center text-slate-500 bg-white rounded-2xl border border-slate-100 shadow-sm">
            Нет точек
          </div>
        ) : (
          quarries.map((quarry) => (
            <div
              key={quarry.id}
              className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm flex flex-col gap-3"
            >
              <div className="flex justify-between items-start gap-2">
                <h3 className="font-semibold text-gray-900 text-lg">
                  {quarry.name}
                </h3>
                <span className="text-xs text-gray-400 shrink-0 font-mono">
                  ID: {quarry.id?.slice(0, 8)}...
                </span>
              </div>
              <div className="text-sm text-gray-600">
                {getQuarryAddress(quarry)}
              </div>
              {(quarry.owner_name || quarry.owner_phone) && (
                <div className="text-xs font-medium text-slate-500">
                  Владелец: {quarry.owner_name || "Имя не указано"}
                  {quarry.owner_phone ? `, ${quarry.owner_phone}` : ""}
                </div>
              )}
              <div className="mt-1 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="mb-2 flex flex-wrap gap-1">
                  <PlacementBadge status={quarry.placement_status} />
                  
                  <span className={`inline-flex items-center rounded-lg px-2 py-1 text-xs font-bold ${moderationBadge(quarry.moderation_status).className}`}>
                    {moderationBadge(quarry.moderation_status).label}
                  </span>
                  {quarry.is_vip ? (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-amber-100 px-2 py-1 text-xs font-black uppercase tracking-wide text-amber-800">
                      <Crown className="h-3.5 w-3.5" />
                      VIP
                    </span>
                  ) : null}
                  {(quarry.manual_priority || 0) > 0 ? (
                    <span className="inline-flex items-center rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
                      #{quarry.manual_priority}
                    </span>
                  ) : null}
                </div>
                <PlacementDates item={quarry} />
                <div className="mt-3 flex max-w-full flex-wrap items-center justify-end gap-2 md:mt-0">
                  <button
                    onClick={() => handleOpenModal(quarry)}
                    className="p-2 text-slate-400 hover:text-[#2DB0E6] hover:bg-[#2DB0E6]/10 rounded-xl transition-all"
                  >
                    <Edit2 className="w-5 h-5" />
                  </button>
                  {quarry.placement_status !== "archived" ? <button type="button" onClick={() => void placementAction(quarry, "extend")} className="rounded-xl bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700">Продлить</button> : null}
                  {quarry.placement_status === "hidden" || quarry.placement_status === "archived" ? <button type="button" onClick={() => void placementAction(quarry, "restore")} className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">Восстановить</button> : <button type="button" onClick={() => void placementAction(quarry, "hide")} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">Скрыть</button>}
                  {quarry.placement_status !== "archived" ? <button type="button" onClick={() => void placementAction(quarry, "archive")} className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-700">В архив</button> : null}
                  <button
                    type="button"
                    disabled={deletingPointId === quarry.id}
                    onClick={() => void deletePoint(quarry)}
                    className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all disabled:opacity-50"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                  {["pending_moderation", "has_pending_changes"].includes(quarry.moderation_status || "") && quarry.id ? (
                    <div className="flex max-w-full flex-wrap items-center justify-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
                      <button disabled={isModerating} onClick={() => void moderatePoint(quarry.id!, "approve")} className="w-28 shrink-0 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 disabled:opacity-50">Одобрить</button>
                      <button disabled={isModerating} onClick={() => rejectPoint(quarry.id!)} className="w-28 shrink-0 rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-50">Отклонить</button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {isModalOpen && editingQuarry && (
        <EnhancedEditQuarryModal
          quarry={editingQuarry}
          materials={materials}
          onClose={() => setIsModalOpen(false)}
          onSave={(savedQuarry) => {
            setQuarries((current) =>
              current.map((item) => (item.id === savedQuarry.id ? savedQuarry : item)),
            );
            setIsModalOpen(false);
            void fetchQuarries();
            void onPointsChanged?.();
          }}
        />
      )}

      {rejectPointId ? (
        <div className="fixed inset-0 z-50 bg-black/50">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
              <h3 className="text-xl font-black text-slate-900">Укажите причину отклонения</h3>
              <p className="mt-2 text-sm text-slate-500">
                Комментарий увидит поставщик в причине отказа по точке.
              </p>
              <textarea
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder="Например: добавьте фото, уточните описание или скорректируйте адрес."
                autoFocus
                rows={5}
                className="mt-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100"
              />
              <div className="mt-5 flex gap-3">
                <button
                  type="button"
                  onClick={closeRejectModal}
                  disabled={isModerating}
                  className="flex-1 rounded-2xl bg-slate-100 px-4 py-3 font-bold text-slate-700 transition hover:bg-slate-200 disabled:opacity-50"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={() => void submitRejectPoint()}
                  disabled={isModerating || !rejectReason.trim()}
                  className="flex-1 rounded-2xl bg-red-500 px-4 py-3 font-bold text-white transition hover:bg-red-600 disabled:opacity-50"
                >
                  Отклонить
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}

function EditQuarryModal({
  quarry,
  materials,
  onClose,
  onSave,
}: {
  quarry: Quarry;
  materials: any[];
  onClose: () => void;
  onSave: (savedQuarry: Quarry) => void;
}) {
  const { token } = useAuthStore();
  const [formData, setFormData] = useState<QuarryFormData>(() => buildQuarryFormData(quarry));
  const [isSaving, setIsSaving] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isMapUnavailable, setIsMapUnavailable] = useState(false);
  const usesOwnerPhone = Boolean(formData.owner_user_id);
  const pointTitle =
    formData.point_type === "accumulator" || formData.point_type === "warehouse"
      ? "накопитель"
      : "карьер";

  const mapContainerRef = React.useRef<HTMLDivElement | null>(null);
  const addressContainerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<any>(null);
  const markerRef = React.useRef<any>(null);
  const lastGeocodedAddressRef = React.useRef(
    normalizeOptionalText(quarry.address)?.toLowerCase() || "",
  );
  const addressBlurTimeoutRef = React.useRef<number | null>(null);

  const getParsedCoordinates = () => {
    const lat = parseCoordinate(formData.lat);
    const lon = parseCoordinate(formData.lon);
    if (lat === null || lon === null) return null;
    return { lat, lon };
  };
  const createDraggableMarker = (mapInstance: any, coordinates: [number, number]) => {
    const mapgl = (window as any).mapgl;
    const marker = new mapgl.Marker(mapInstance, {
      coordinates,
      draggable: true,
    });
    marker.on("dragend", (event: any) => {
      const [nextLon, nextLat] = event.target.getCoordinates();
      setFormData((current) => ({
        ...current,
        lat: stringifyCoordinate(nextLat),
        lon: stringifyCoordinate(nextLon),
      }));
    });
    return marker;
  };
  const totalPhotoCount = (formData.media_files?.length || 0) + pendingFiles.length;

  React.useEffect(() => {
    const mapgl = (window as any).mapgl;
    const key = import.meta.env.VITE_2GIS_KEY;
    if (!mapgl || !key || !mapContainerRef.current || mapRef.current) return;

    const initialCoordinates = getParsedCoordinates();
    const mapInstance = tryCreate2GisMap(
      () =>
        new mapgl.Map(mapContainerRef.current, {
          center: initialCoordinates
            ? [initialCoordinates.lon, initialCoordinates.lat]
            : [65.527202, 57.152223],
          zoom: 12,
          key,
        }),
      () => setIsMapUnavailable(true),
    );
    if (!mapInstance) return;

    mapRef.current = mapInstance;

    if (initialCoordinates) {
      markerRef.current = createDraggableMarker(mapInstance, [
        initialCoordinates.lon,
        initialCoordinates.lat,
      ]);
    }

    return () => {
      if (addressBlurTimeoutRef.current) {
        window.clearTimeout(addressBlurTimeoutRef.current);
        addressBlurTimeoutRef.current = null;
      }
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
      if (markerRef.current) {
        markerRef.current.destroy();
        markerRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => {
    const handleDocumentMouseDown = (event: MouseEvent) => {
      if (!addressContainerRef.current?.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => document.removeEventListener("mousedown", handleDocumentMouseDown);
  }, []);

  React.useEffect(() => {
    const coordinates = getParsedCoordinates();
    const mapgl = (window as any).mapgl;
    if (!mapRef.current || !mapgl || !coordinates) return;

    const point: [number, number] = [coordinates.lon, coordinates.lat];
    mapRef.current.setCenter(point);

    if (markerRef.current) {
      markerRef.current.setCoordinates(point);
      return;
    }

    markerRef.current = createDraggableMarker(mapRef.current, point);
  }, [formData.lat, formData.lon]);

  const handleLatChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const coordsArray = value.split(/[,\s]+/);
    if (coordsArray.length >= 2) {
      const parsedLat = parseCoordinate(coordsArray[0]);
      const parsedLon = parseCoordinate(coordsArray[1]);
      if (parsedLat !== null && parsedLon !== null) {
        setFormData((prev) => ({
          ...prev,
          lat: stringifyCoordinate(parsedLat),
          lon: stringifyCoordinate(parsedLon),
        }));
        return;
      }
    }
    setFormData((prev) => ({ ...prev, lat: value }));
  };

  const getCoordsFromBackend = async (address: string) => {
    setIsGeocoding(true);
    if (formData.is_active && totalPhotoCount === 0) {
      toast.error("Р”Р»СЏ Р°РєС‚РёРІР°С†РёРё РґРѕР±Р°РІСЊС‚Рµ С…РѕС‚СЏ Р±С‹ РѕРґРЅСѓ С„РѕС‚РѕРіСЂР°С„РёСЋ");
      return;
    }

    try {
      const res = await fetch(
        `${baseURL}/geo/geocode?address=${encodeURIComponent(withTyumenBias(address))}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (res.ok) {
        const data = await res.json();
        const lat = Number(data.lat);
        const lon = Number(data.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          return { lat, lon };
        }
      }
    } catch (error) {
      void error;
    } finally {
      setIsGeocoding(false);
    }
    return null;
  };

  const syncAddressCoordinates = async (addressOverride?: string) => {
    const normalizedAddress = normalizeOptionalText(addressOverride ?? formData.address);
    if (!normalizedAddress) return;

    const addressKey = normalizedAddress.toLowerCase();
    if (lastGeocodedAddressRef.current === addressKey) return;

    const coords = await getCoordsFromBackend(normalizedAddress);
    if (!coords) return;

    lastGeocodedAddressRef.current = addressKey;
    setFormData((prev) => ({
      ...prev,
      address: normalizedAddress,
      lat: stringifyCoordinate(coords.lat),
      lon: stringifyCoordinate(coords.lon),
    }));
  };

  const handleAddressChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const val = e.target.value;
    lastGeocodedAddressRef.current = "";
    setFormData((prev) => ({ ...prev, address: val }));
    if (!val.trim()) {
      setSuggestions([]);
      return;
    }

    const suggests = await fetch2gisAddressSuggestions(val);
    setSuggestions(
      suggests
        .map((suggestion: any) => {
          const address = get2gisSuggestionAddress(suggestion);
          const label = get2gisSuggestionLabel(suggestion);
          const { lat, lon } = get2gisSuggestionCoordinates(suggestion);
          return {
            label: label || address,
            address,
            lat,
            lon,
          };
        })
        .filter((item) => Boolean(item.address)),
    );
  };

  const selectSuggestion = async (suggestion: AddressSuggestion) => {
    const address = suggestion.address.trim() || suggestion.label.trim();
    setFormData((prev) => ({ ...prev, address }));
    setSuggestions([]);

    if (typeof suggestion.lat === "number" && typeof suggestion.lon === "number") {
      lastGeocodedAddressRef.current = address.toLowerCase();
      setFormData((prev) => ({
        ...prev,
        address,
        lat: stringifyCoordinate(suggestion.lat),
        lon: stringifyCoordinate(suggestion.lon),
      }));
      return;
    }

    const coords = await getCoordsFromBackend(address);
    if (!coords) return;

    lastGeocodedAddressRef.current = address.toLowerCase();
    setFormData((prev) => ({
      ...prev,
      address,
      lat: stringifyCoordinate(coords.lat),
      lon: stringifyCoordinate(coords.lon),
    }));
  };

  const toggleMaterial = (id: string) => {
    setFormData((prev) => {
      const ids = prev.material_ids || [];
      if (ids.includes(id)) {
        return {
          ...prev,
          material_ids: ids.filter((m) => m !== id),
          material_offers: (prev.material_offers || []).filter(
            (offer) => offer.material_id !== id,
          ),
        };
      } else {
        const material = materials.find((item) => item.id === id);
        return {
          ...prev,
          material_ids: [...ids, id],
          material_offers: [
            ...(prev.material_offers || []),
            {
              material_id: id,
              price: Number(material?.price || 0),
              is_active: true,
            },
          ],
        };
      }
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    const nameTrimmed = formData.name?.trim() || "";
    const addressTrimmed = formData.address?.trim() || "";
    const parsedCoordinates = getParsedCoordinates();
    const hasCoords = Boolean(parsedCoordinates);
    const totalPhotoCount = (formData.media_files?.length || 0) + pendingFiles.length;

    if (!nameTrimmed) {
      toast.error("Пожалуйста, введите название карьера");
      return;
    }

    if (!addressTrimmed && !hasCoords) {
      toast.error(
        "Необходимо указать адрес или заполнить координаты (Широту и Долготу)",
      );
      return;
    }

    const finalAddress =
      addressTrimmed || `По координатам: ${formData.lat}, ${formData.lon}`;

    try {
      setIsSaving(true);
      let lat = parsedCoordinates?.lat ?? null;
      let lon = parsedCoordinates?.lon ?? null;
      if (lat === null || lon === null) {
        const geocoded = await getCoordsFromBackend(addressTrimmed);
        if (!geocoded) {
          throw new Error("Не удалось определить координаты по адресу");
        }
        lat = geocoded.lat;
        lon = geocoded.lon;
        lastGeocodedAddressRef.current = addressTrimmed.toLowerCase();
        setFormData((prev) => ({
          ...prev,
          lat: stringifyCoordinate(lat),
          lon: stringifyCoordinate(lon),
        }));
      }

      const requestedActive = Boolean(formData.is_active);
      const shouldDelayActivation = !formData.id && requestedActive && pendingFiles.length > 0;
      const finalAddress =
        addressTrimmed || `По координатам: ${lat}, ${lon}`;
      const url = formData.id
        ? `${baseURL}/admin/quarries/${formData.id}`
        : `${baseURL}/admin/quarries`;

      const normalizedMaterialOffers = (formData.material_offers || [])
        .filter((item) => item.material_id)
        .map((item) => ({
          material_id: item.material_id,
          price: Number(item.price || 0),
          is_active: Boolean(item.is_active),
        }));

      const payload = {
        name: nameTrimmed,
        point_type: formData.point_type,
        address: finalAddress,
        description: normalizeOptionalText(formData.description),
        subscription_end_date: serializeSubscriptionEndDate(formData.subscription_end_date),
        lat,
        lon,
        is_active: shouldDelayActivation ? false : requestedActive,
        is_vip: Boolean(formData.is_vip),
        manual_priority: normalizeManualPriority(formData.manual_priority),
        material_ids: Array.from(new Set((formData.material_ids || []).filter(Boolean))),
        material_offers: normalizedMaterialOffers,
        ...(usesOwnerPhone ? {} : { contact_phone: normalizeOptionalText(formData.contact_phone) }),
      };

      const res = await fetch(url, {
        method: formData.id ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const responseData = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof responseData.detail === "string"
            ? responseData.detail
            : "Ошибка при сохранении",
        );
      }
      toast.success("Карьер сохранен");
      let savedPoint = responseData as Quarry;
      if (pendingFiles.length > 0 && savedPoint.id) {
        const uploadedMedia = await uploadPendingFilesForPoint(
          savedPoint.id,
          pendingFiles,
          savedPoint.media_files || [],
        );
        savedPoint = {
          ...savedPoint,
          media_files: uploadedMedia,
          primary_image_url:
            uploadedMedia.find((media) => media.is_primary)?.public_url ||
            uploadedMedia[0]?.public_url ||
            null,
        };
        setPendingFiles([]);
      }

      if (shouldDelayActivation && savedPoint.id) {
        const activationResponse = await fetch(`${baseURL}/admin/quarries/${savedPoint.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ is_active: true }),
        });
        const activationData = await activationResponse.json().catch(() => ({}));
        if (!activationResponse.ok) {
          throw new Error(
            typeof activationData.detail === "string"
              ? activationData.detail
              : "Не удалось активировать точку после загрузки фото",
          );
        }
      }

      onSave(savedPoint);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка при сохранении");
    } finally {
      setIsSaving(false);
    }
  };

  const uploadPointPhotos = async (files: File[]) => {
    if (!formData.id || files.length === 0) return;
    setIsSaving(true);
    let nextMedia = [...(formData.media_files || [])];
    try {
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
      for (const file of files) {
        const isPrimary = nextMedia.length === 0;
        const presignResponse = await fetch(`${baseURL}/media/presign-upload`, {
          method: "POST",
          headers,
          body: JSON.stringify({ file_name: file.name, content_type: file.type, file_size: file.size, entity_type: "quarry", entity_id: formData.id, is_primary: isPrimary }),
        });
        const presign = await presignResponse.json();
        if (!presignResponse.ok) throw new Error("presign failed");
        const uploadResponse = await fetch(presign.upload_url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        if (!uploadResponse.ok) throw new Error("upload failed");
        const confirmResponse = await fetch(`${baseURL}/media/confirm`, {
          method: "POST",
          headers,
          body: JSON.stringify({ entity_type: "quarry", entity_id: formData.id, object_key: presign.object_key, file_name: file.name, content_type: file.type, file_size: file.size, is_primary: isPrimary }),
        });
        const confirmed = await confirmResponse.json();
        if (!confirmResponse.ok) throw new Error("confirm failed");
        nextMedia = [...nextMedia, confirmed.media_file];
        setFormData((previous) => ({
          ...previous,
          media_files: nextMedia,
          primary_image_url: previous.primary_image_url || confirmed.media_file.public_url,
        }));
      }
      toast.success(files.length === 1 ? "Фотография добавлена" : `Добавлено фотографий: ${files.length}`);
    } catch {
      toast.error("Не удалось загрузить одну или несколько фотографий");
    } finally {
      setIsSaving(false);
    }
  };

  const uploadPendingFilesForPoint = async (
    pointId: string,
    files: File[],
    initialMedia: QuarryMediaFile[] = [],
  ) => {
    let nextMedia = [...initialMedia];
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

    for (const file of files) {
      const isPrimary = nextMedia.length === 0;
      const presignResponse = await fetch(`${baseURL}/media/presign-upload`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          file_name: file.name,
          content_type: file.type,
          file_size: file.size,
          entity_type: "quarry",
          entity_id: pointId,
          is_primary: isPrimary,
        }),
      });
      const presign = await presignResponse.json().catch(() => ({}));
      if (!presignResponse.ok) {
        throw new Error("Не удалось подготовить загрузку фотографии");
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
        headers,
        body: JSON.stringify({
          entity_type: "quarry",
          entity_id: pointId,
          object_key: presign.object_key,
          file_name: file.name,
          content_type: file.type,
          file_size: file.size,
          is_primary: isPrimary,
        }),
      });
      const confirmed = await confirmResponse.json().catch(() => ({}));
      if (!confirmResponse.ok || !confirmed.media_file) {
        throw new Error("Не удалось подтвердить фотографию");
      }

      nextMedia = [...nextMedia, confirmed.media_file];
    }

    return nextMedia;
  };

  const handleSelectedFiles = async (files: File[]) => {
    if (files.length === 0) return;

    if (!formData.id) {
      setPendingFiles((current) => [...current, ...files]);
      return;
    }

    void uploadPointPhotos(files);
  };

  const removePendingPhoto = (index: number) => {
    setPendingFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
  };

  const deletePointPhoto = async (mediaId: string) => {
    if (!window.confirm("Удалить эту фотографию?")) return;
    setIsSaving(true);
    try {
      const response = await fetch(`${baseURL}/media/${mediaId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("delete failed");
      setFormData((previous) => {
        const mediaFiles = (previous.media_files || []).filter((media) => media.id !== mediaId);
        return {
          ...previous,
          media_files: mediaFiles,
          primary_image_url: mediaFiles.find((media) => media.is_primary)?.public_url || mediaFiles[0]?.public_url || null,
        };
      });
      toast.success("Фотография удалена");
    } catch {
      toast.error("Не удалось удалить фотографию");
    } finally {
      setIsSaving(false);
    }
  };

  const makePointPhotoPrimary = async (mediaId: string) => {
    setIsSaving(true);
    try {
      const response = await fetch(`${baseURL}/media/${mediaId}/make-primary`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("make primary failed");
      setFormData((previous) => {
        const mediaFiles = (previous.media_files || []).map((media) => ({
          ...media,
          is_primary: media.id === mediaId,
        }));
        return {
          ...previous,
          media_files: mediaFiles,
          primary_image_url: mediaFiles.find((media) => media.id === mediaId)?.public_url || null,
        };
      });
      toast.success("Главная фотография обновлена");
    } catch {
      toast.error("Не удалось выбрать главную фотографию");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="mb-16 flex max-h-[calc(100vh-6rem)] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl md:mb-0 md:max-h-[90vh]">
        <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h3 className="text-xl font-bold text-slate-800">
            {formData.id ? `Редактировать ${pointTitle}` : `Добавить ${pointTitle}`}
          </h3>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-600 rounded-full transition-colors"
          >
            <span className="text-xl leading-none">&times;</span>
          </button>
        </div>

        <form
          onSubmit={handleSave}
          className="flex flex-col gap-5 overflow-y-auto p-6 pb-36"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Название
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Тип точки</label>
              <select
                value={formData.point_type}
                onChange={(event) => {
                  const pointType = event.target.value as EditablePointType;
                  setFormData({ ...formData, point_type: pointType });
                }}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3"
              >
                <option value="quarry">Карьер</option>
                <option value="accumulator">Накопитель</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 items-start md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Контактный телефон
              </label>
              <input
                type="tel"
                value={formData.contact_phone || ""}
                disabled={usesOwnerPhone}
                onChange={(event) =>
                  setFormData({
                    ...formData,
                    contact_phone: formatPhoneNumber(event.target.value),
                  })
                }
                placeholder="+7 (900) 000-00-00"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
              />
              {usesOwnerPhone && (
                <p className="text-xs text-slate-500">Берется из профиля поставщика</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Действует до
              </label>
              <input
                type="date"
                value={formData.subscription_end_date || ""}
                max="2099-12-31"
                onChange={(event) =>
                  setFormData({
                    ...formData,
                    subscription_end_date:
                      normalizeSubscriptionDateInput(event.target.value) || null,
                  })
                }
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5 relative">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Адрес
            </label>
            <input
              type="text"
              value={formData.address}
              onChange={handleAddressChange}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
            />
            {suggestions.length > 0 && (
              <ul className="absolute z-[9999] top-full mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-2xl max-h-48 overflow-y-auto">
                {suggestions.map((addr, idx) => (
                  <li
                    key={idx}
                    onClick={() => selectSuggestion(addr)}
                    className="px-4 py-3 hover:bg-slate-50 cursor-pointer border-b border-gray-100 last:border-0 text-sm"
                  >
                    {addr}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Описание
            </label>
            <textarea
              rows={4}
              maxLength={5000}
              value={formData.description || ""}
              onChange={(event) => setFormData({ ...formData, description: event.target.value })}
              placeholder="Опишите точку, условия погрузки и ориентиры"
              className="w-full resize-y bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all"
            />
          </div>

          {/* Контейнер для карты 2ГИС */}
          {isMapUnavailable ? (
            <MapWebGLFallback className="my-4 h-48 min-h-[192px] w-full rounded-xl" />
          ) : (
            <div
              ref={mapContainerRef}
              className="my-4 h-48 min-h-[192px] w-full overflow-hidden rounded-xl bg-gray-200"
            />
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Широта (Lat)
              </label>
              <input
                type="text"
                value={formData.lat || ""}
                onChange={handleLatChange}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Долгота (Lon)
              </label>
              <input
                type="text"
                value={formData.lon || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    lon: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Материалы карьера
            </label>
            <div className="max-h-40 overflow-y-auto bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col gap-2">
              {materials.map((m) => {
                const offer = (formData.material_offers || []).find((item) => item.material_id === m.id);
                return (
                <div
                  key={m.id}
                  className="flex items-center gap-3 p-1"
                >
                  <input
                    type="checkbox"
                    checked={(formData.material_ids || []).includes(m.id)}
                    onChange={() => toggleMaterial(m.id)}
                    className="w-5 h-5 rounded border-slate-300 text-[#2DB0E6] focus:ring-[#2DB0E6]"
                  />
                  <span className="text-sm font-medium text-slate-700">
                    {m.name}
                  </span>
                  {offer && (
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={offer.price ?? ""}
                      onChange={(event) => setFormData({
                        ...formData,
                        material_offers: (formData.material_offers || []).map((item) => item.material_id === m.id ? { ...item, price: Number(event.target.value) } : item),
                      })}
                      className="ml-auto w-28 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                      placeholder="Цена"
                    />
                  )}
                </div>
              )})}
            </div>
          </div>

          {formData.id && (
            <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-slate-700">Фотографии</div>
                  <div className="text-xs text-slate-500">Можно выбрать несколько файлов</div>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-[#2DB0E6] hover:text-[#2DB0E6]">
                  <ImagePlus className="h-4 w-4" />
                  Добавить
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      const files = Array.from(event.target.files || []) as File[];
                      event.target.value = "";
                      void uploadPointPhotos(files);
                    }}
                  />
                </label>
              </div>
              {(formData.media_files || []).length > 0 ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {(formData.media_files || []).map((media) => (
                    <div key={media.id} className="group relative aspect-square overflow-hidden rounded-xl bg-slate-200">
                      <img src={media.public_url} alt={media.file_name || "Фотография точки"} className="h-full w-full object-cover" />
                      {media.is_primary && (
                        <span className="absolute left-2 top-2 rounded-full bg-slate-900/75 px-2 py-1 text-[10px] font-bold text-white">Основное</span>
                      )}
                      <button
                        type="button"
                        aria-label={media.is_primary ? "Главная фотография" : "Сделать главной"}
                        title={media.is_primary ? "Главная фотография" : "Сделать главной"}
                        disabled={media.is_primary || isSaving}
                        onClick={() => void makePointPhotoPrimary(media.id)}
                        className="absolute bottom-2 left-2 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-amber-500 shadow hover:bg-white disabled:cursor-default disabled:bg-amber-100"
                      >
                        <Star className={`h-4 w-4 ${media.is_primary ? "fill-current" : ""}`} />
                      </button>
                      <button
                        type="button"
                        aria-label="Удалить фотографию"
                        onClick={() => void deletePointPhoto(media.id)}
                        className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-rose-600 shadow hover:bg-white"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
                  Фотографии пока не добавлены
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={formData.is_active}
                onChange={(e) =>
                  setFormData({ ...formData, is_active: e.target.checked })
                }
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
              <span className="ml-3 text-sm font-medium text-slate-700">
                Активен
              </span>
            </label>
          </div>

          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 py-3.5 bg-[#2DB0E6] hover:bg-[#209BD6] text-white rounded-xl font-bold transition-colors disabled:opacity-70 disabled:cursor-not-allowed flex justify-center items-center gap-2"
            >
              {isSaving ? "Сохранение..." : "Сохранить"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EnhancedEditQuarryModal({
  quarry,
  materials,
  onClose,
  onSave,
}: {
  quarry: Quarry;
  materials: any[];
  onClose: () => void;
  onSave: (savedQuarry: Quarry) => void;
}) {
  const { token } = useAuthStore();
  const [formData, setFormData] = useState<QuarryFormData>(() => buildQuarryFormData(quarry));
  const [isSaving, setIsSaving] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingFilePreviews, setPendingFilePreviews] = useState<string[]>([]);
  const [isMapUnavailable, setIsMapUnavailable] = useState(false);
  const usesOwnerPhone = Boolean(formData.owner_user_id);
  const pointTitle = formData.point_type === "accumulator" ? "накопитель" : "карьер";

  const mapContainerRef = React.useRef<HTMLDivElement | null>(null);
  const addressContainerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<any>(null);
  const markerRef = React.useRef<any>(null);
  const blurTimeoutRef = React.useRef<number | null>(null);
  const lastGeocodedAddressRef = React.useRef(
    normalizeOptionalText(quarry.address)?.toLowerCase() || "",
  );

  useEffect(() => {
    const previews = pendingFiles.map((file) => URL.createObjectURL(file));
    setPendingFilePreviews(previews);
    return () => previews.forEach((preview) => URL.revokeObjectURL(preview));
  }, [pendingFiles]);

  const getParsedCoordinates = () => {
    const lat = parseCoordinate(formData.lat);
    const lon = parseCoordinate(formData.lon);
    if (lat === null || lon === null) return null;
    return { lat, lon };
  };
  const createDraggableMarker = (mapInstance: any, coordinates: [number, number]) => {
    const mapgl = (window as any).mapgl;
    const marker = new mapgl.Marker(mapInstance, {
      coordinates,
      draggable: true,
    });
    marker.on("dragend", (event: any) => {
      const [nextLon, nextLat] = event.target.getCoordinates();
      setFormData((current) => ({
        ...current,
        lat: stringifyCoordinate(nextLat),
        lon: stringifyCoordinate(nextLon),
      }));
    });
    return marker;
  };

  React.useEffect(() => {
    const mapgl = (window as any).mapgl;
    const key = import.meta.env.VITE_2GIS_KEY;
    if (!mapgl || !key || !mapContainerRef.current || mapRef.current) return;

    const initialCoordinates = getParsedCoordinates();
    const mapInstance = tryCreate2GisMap(
      () =>
        new mapgl.Map(mapContainerRef.current, {
          center: initialCoordinates
            ? [initialCoordinates.lon, initialCoordinates.lat]
            : [65.527202, 57.152223],
          zoom: 12,
          key,
        }),
      () => setIsMapUnavailable(true),
    );
    if (!mapInstance) return;

    mapRef.current = mapInstance;
    if (initialCoordinates) {
      markerRef.current = createDraggableMarker(mapInstance, [
        initialCoordinates.lon,
        initialCoordinates.lat,
      ]);
    }

    return () => {
      if (blurTimeoutRef.current) {
        window.clearTimeout(blurTimeoutRef.current);
      }
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
      if (markerRef.current) {
        markerRef.current.destroy();
        markerRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => {
    const handleDocumentMouseDown = (event: MouseEvent) => {
      if (!addressContainerRef.current?.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => document.removeEventListener("mousedown", handleDocumentMouseDown);
  }, []);

  React.useEffect(() => {
    const coordinates = getParsedCoordinates();
    const mapgl = (window as any).mapgl;
    if (!mapRef.current || !mapgl || !coordinates) return;

    const point: [number, number] = [coordinates.lon, coordinates.lat];
    mapRef.current.setCenter(point);
    if (markerRef.current) {
      markerRef.current.setCoordinates(point);
      return;
    }
    markerRef.current = createDraggableMarker(mapRef.current, point);
  }, [formData.lat, formData.lon]);

  const geocodeAddress = async (address: string) => {
    setIsGeocoding(true);
    try {
      const response = await fetch(
        `${baseURL}/geo/geocode?address=${encodeURIComponent(withTyumenBias(address))}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await response.json().catch(() => ({}));
      const lat = Number(data.lat);
      const lon = Number(data.lon);
      if (!response.ok || !Number.isFinite(lat) || !Number.isFinite(lon)) {
        throw new Error(extractApiErrorMessage(data, "Не удалось определить координаты"));
      }
      return { lat, lon };
    } finally {
      setIsGeocoding(false);
    }
  };

  const syncAddressCoordinates = async (addressOverride?: string) => {
    const address = normalizeOptionalText(addressOverride ?? formData.address);
    if (!address) return;
    const normalizedAddress = address.toLowerCase();
    if (lastGeocodedAddressRef.current === normalizedAddress) return;
    const coords = await geocodeAddress(address);
    lastGeocodedAddressRef.current = normalizedAddress;
    setFormData((current) => ({
      ...current,
      address,
      lat: stringifyCoordinate(coords.lat),
      lon: stringifyCoordinate(coords.lon),
    }));
  };

  const handleLatChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    const coords = value.split(/[,\s]+/);
    if (coords.length >= 2) {
      const lat = parseCoordinate(coords[0]);
      const lon = parseCoordinate(coords[1]);
      if (lat !== null && lon !== null) {
        setFormData((current) => ({
          ...current,
          lat: stringifyCoordinate(lat),
          lon: stringifyCoordinate(lon),
        }));
        return;
      }
    }
    setFormData((current) => ({ ...current, lat: value }));
  };

  const handleAddressChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    lastGeocodedAddressRef.current = "";
    setFormData((current) => ({ ...current, address: value }));
    if (!value.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    setShowSuggestions(true);
    const results = await fetch2gisAddressSuggestions(value);
    setSuggestions(
      results
        .map((item: any) => {
          const address = get2gisSuggestionAddress(item);
          const label = get2gisSuggestionLabel(item);
          const { lat, lon } = get2gisSuggestionCoordinates(item);
          return {
            label: label || address,
            address,
            lat,
            lon,
          };
        })
        .filter((item) => Boolean(item.address)),
    );
  };

  const handleSuggestionSelect = async (suggestion: AddressSuggestion) => {
    const address = suggestion.address.trim() || suggestion.label.trim();
    setSuggestions([]);
    setShowSuggestions(false);
    setFormData((current) => ({
      ...current,
      address,
    }));

    if (typeof suggestion.lat === "number" && typeof suggestion.lon === "number") {
      lastGeocodedAddressRef.current = address.toLowerCase();
      setFormData((current) => ({
        ...current,
        lat: stringifyCoordinate(suggestion.lat),
        lon: stringifyCoordinate(suggestion.lon),
      }));
      return;
    }

    try {
      const coords = await geocodeAddress(address);
      lastGeocodedAddressRef.current = address.toLowerCase();
      setFormData((current) => ({
        ...current,
        lat: stringifyCoordinate(coords.lat),
        lon: stringifyCoordinate(coords.lon),
      }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось определить координаты по адресу");
    }
  };

  const toggleMaterial = (id: string) => {
    setFormData((current) => {
      const ids = current.material_ids || [];
      if (ids.includes(id)) {
        return {
          ...current,
          material_ids: ids.filter((item) => item !== id),
          material_offers: (current.material_offers || []).filter(
            (offer) => offer.material_id !== id,
          ),
        };
      }

      const material = materials.find((item) => item.id === id);
      return {
        ...current,
        material_ids: [...ids, id],
        material_offers: [
          ...(current.material_offers || []),
          {
            material_id: id,
            price: Number(material?.price || 0),
            is_active: true,
          },
        ],
      };
    });
  };

  const uploadMediaFiles = async (
    pointId: string,
    files: File[],
    initialMedia: QuarryMediaFile[] = [],
  ) => {
    let nextMedia = [...initialMedia];
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

    for (const file of files) {
      const isPrimary = nextMedia.length === 0;
      const presignResponse = await fetch(`${baseURL}/media/presign-upload`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          file_name: file.name,
          content_type: file.type,
          file_size: file.size,
          entity_type: "quarry",
          entity_id: pointId,
          is_primary: isPrimary,
        }),
      });
      const presign = await presignResponse.json().catch(() => ({}));
      if (!presignResponse.ok) {
        throw new Error("Не удалось подготовить загрузку фотографии");
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
        headers,
        body: JSON.stringify({
          entity_type: "quarry",
          entity_id: pointId,
          object_key: presign.object_key,
          file_name: file.name,
          content_type: file.type,
          file_size: file.size,
          is_primary: isPrimary,
        }),
      });
      const confirmed = await confirmResponse.json().catch(() => ({}));
      if (!confirmResponse.ok || !confirmed.media_file) {
        throw new Error("Не удалось подтвердить фотографию");
      }
      nextMedia = [...nextMedia, confirmed.media_file];
    }

    return nextMedia;
  };

  const handleSelectedFiles = async (files: File[]) => {
    if (files.length === 0) return;

    if (!formData.id) {
      setPendingFiles((current) => [...current, ...files]);
      return;
    }

    setIsSaving(true);
    try {
      const nextMedia = await uploadMediaFiles(formData.id, files, formData.media_files || []);
      setFormData((current) => ({
        ...current,
        media_files: nextMedia,
        primary_image_url:
          nextMedia.find((media) => media.is_primary)?.public_url ||
          nextMedia[0]?.public_url ||
          null,
      }));
      toast.success(files.length === 1 ? "Фотография добавлена" : `Добавлено фотографий: ${files.length}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить фотографии");
    } finally {
      setIsSaving(false);
    }
  };

  const removePendingPhoto = (index: number) => {
    setPendingFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
  };

  const deletePointPhoto = async (mediaId: string) => {
    if (!window.confirm("Удалить эту фотографию?")) return;
    setIsSaving(true);
    try {
      const response = await fetch(`${baseURL}/media/${mediaId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("delete failed");
      setFormData((current) => {
        const nextMedia = (current.media_files || []).filter((media) => media.id !== mediaId);
        return {
          ...current,
          media_files: nextMedia,
          primary_image_url:
            nextMedia.find((media) => media.is_primary)?.public_url ||
            nextMedia[0]?.public_url ||
            null,
        };
      });
      toast.success("Фотография удалена");
    } catch {
      toast.error("Не удалось удалить фотографию");
    } finally {
      setIsSaving(false);
    }
  };

  const makePointPhotoPrimary = async (mediaId: string) => {
    setIsSaving(true);
    try {
      const response = await fetch(`${baseURL}/media/${mediaId}/make-primary`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("make primary failed");
      setFormData((current) => {
        const nextMedia = (current.media_files || []).map((media) => ({
          ...media,
          is_primary: media.id === mediaId,
        }));
        return {
          ...current,
          media_files: nextMedia,
          primary_image_url:
            nextMedia.find((media) => media.id === mediaId)?.public_url || null,
        };
      });
      toast.success("Главная фотография обновлена");
    } catch {
      toast.error("Не удалось выбрать главную фотографию");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();

    const nameTrimmed = formData.name.trim();
    const addressTrimmed = formData.address.trim();
    const parsedCoordinates = getParsedCoordinates();
    const totalPhotoCount = (formData.media_files?.length || 0) + pendingFiles.length;

    if (!nameTrimmed) {
      toast.error("Укажите название точки");
      return;
    }
    if (!addressTrimmed && !parsedCoordinates) {
      toast.error("Укажите адрес или координаты точки");
      return;
    }
    if (formData.is_active && totalPhotoCount === 0) {
      toast.error("Для активации добавьте хотя бы одну фотографию");
      return;
    }

    setIsSaving(true);
    try {
      let lat = parsedCoordinates?.lat ?? null;
      let lon = parsedCoordinates?.lon ?? null;
      if (lat === null || lon === null) {
        const geocoded = await geocodeAddress(addressTrimmed);
        lat = geocoded.lat;
        lon = geocoded.lon;
        lastGeocodedAddressRef.current = addressTrimmed.toLowerCase();
        setFormData((current) => ({
          ...current,
          lat: stringifyCoordinate(lat),
          lon: stringifyCoordinate(lon),
        }));
      }

      const requestedActive = Boolean(formData.is_active);
      const shouldDelayActivation = !formData.id && requestedActive && pendingFiles.length > 0;
      const normalizedMaterialOffers = (formData.material_offers || [])
        .filter((item) => item.material_id)
        .map((item) => ({
          material_id: item.material_id,
          price: Number(item.price || 0),
          is_active: Boolean(item.is_active),
        }));

      const payload = {
        name: nameTrimmed,
        point_type: formData.point_type,
        address: addressTrimmed || `По координатам: ${lat}, ${lon}`,
        description: normalizeOptionalText(formData.description),
        subscription_end_date: serializeSubscriptionEndDate(formData.subscription_end_date),
        lat,
        lon,
        is_active: shouldDelayActivation ? false : requestedActive,
        is_vip: Boolean(formData.is_vip),
        manual_priority: normalizeManualPriority(formData.manual_priority),
        material_ids: Array.from(new Set((formData.material_ids || []).filter(Boolean))),
        material_offers: normalizedMaterialOffers,
        ...(usesOwnerPhone ? {} : { contact_phone: normalizeOptionalText(formData.contact_phone) }),
      };

      const response = await fetch(
        formData.id ? `${baseURL}/admin/quarries/${formData.id}` : `${baseURL}/admin/quarries`,
        {
          method: formData.id ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data, "Не удалось сохранить точку"));
      }

      let savedPoint = data as Quarry;
      if (pendingFiles.length > 0 && savedPoint.id) {
        const uploadedMedia = await uploadMediaFiles(
          savedPoint.id,
          pendingFiles,
          savedPoint.media_files || [],
        );
        savedPoint = {
          ...savedPoint,
          media_files: uploadedMedia,
        };
        setPendingFiles([]);
      }

      if (shouldDelayActivation && savedPoint.id) {
        const activationResponse = await fetch(`${baseURL}/admin/quarries/${savedPoint.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ is_active: true }),
        });
        const activationData = await activationResponse.json().catch(() => ({}));
        if (!activationResponse.ok) {
          throw new Error(extractApiErrorMessage(activationData, "Не удалось активировать точку"));
        }
      }

      toast.success("Карьер сохранен");
      onSave(savedPoint);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить точку");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="mb-16 flex max-h-[calc(100vh-6rem)] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl md:mb-0 md:max-h-[90vh]">
        <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h3 className="text-xl font-bold text-slate-800">
            {formData.id ? `Редактировать ${pointTitle}` : `Добавить ${pointTitle}`}
          </h3>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-600 rounded-full transition-colors"
          >
            <span className="text-xl leading-none">&times;</span>
          </button>
        </div>

        <form
          onSubmit={handleSave}
          className="flex flex-col gap-5 overflow-y-auto p-6 pb-36"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Название</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(event) => setFormData({ ...formData, name: event.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Тип точки</label>
              <select
                value={formData.point_type}
                onChange={(event) =>
                  setFormData({ ...formData, point_type: event.target.value as EditablePointType })
                }
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3"
              >
                <option value="quarry">Карьер</option>
                <option value="accumulator">Накопитель</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 items-start md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Контактный телефон</label>
              <input
                type="tel"
                value={formData.contact_phone || ""}
                disabled={usesOwnerPhone}
                onChange={(event) =>
                  setFormData({
                    ...formData,
                    contact_phone: formatPhoneNumber(event.target.value),
                  })
                }
                placeholder="+7 (900) 000-00-00"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
              />
              {usesOwnerPhone ? (
                <p className="text-xs text-slate-500">Берется из профиля поставщика</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Действует до</label>
              <input
                type="date"
                value={formData.subscription_end_date || ""}
                onChange={(event) =>
                  setFormData({
                    ...formData,
                    subscription_end_date:
                      normalizeSubscriptionDateInput(event.target.value) || null,
                  })
                }
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Описание</label>
            <textarea
              rows={4}
              maxLength={5000}
              value={formData.description || ""}
              onChange={(event) => setFormData({ ...formData, description: event.target.value })}
              placeholder="Опишите точку, условия погрузки и ориентиры"
              className="w-full resize-y bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all"
            />
          </div>

          <div ref={addressContainerRef} className="flex flex-col gap-1.5 relative">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Адрес</label>
            <div className="relative">
              <input
                type="text"
                value={formData.address}
                onChange={handleAddressChange}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => {
                  blurTimeoutRef.current = window.setTimeout(() => {
                    void syncAddressCoordinates();
                  }, 150);
                }}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 pr-12 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
              />
              {isGeocoding ? (
                <div className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs font-semibold text-[#2DB0E6]">
                  ...
                </div>
              ) : null}
            </div>
            {showSuggestions && suggestions.length > 0 ? (
              <ul className="absolute z-[9999] top-full mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-2xl max-h-48 overflow-y-auto">
                {suggestions.map((suggestion, index) => (
                  <li
                    key={`${suggestion.label}-${index}`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      if (blurTimeoutRef.current) {
                        window.clearTimeout(blurTimeoutRef.current);
                        blurTimeoutRef.current = null;
                      }
                      void handleSuggestionSelect(suggestion);
                    }}
                    className="px-4 py-3 hover:bg-slate-50 cursor-pointer border-b border-gray-100 last:border-0 text-sm"
                  >
                    {suggestion.label}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-xs text-slate-500">
              Адрес и карта синхронизируются по подсказкам 2ГИС и введенным координатам.
            </p>
          </div>

          {isMapUnavailable ? (
            <MapWebGLFallback className="h-48 min-h-[192px] w-full rounded-xl" />
          ) : (
            <div ref={mapContainerRef} className="h-48 min-h-[192px] w-full overflow-hidden rounded-xl bg-gray-200" />
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Широта (Lat)</label>
              <input
                type="text"
                value={formData.lat}
                onChange={handleLatChange}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Долгота (Lon)</label>
              <input
                type="text"
                value={formData.lon}
                onChange={(event) => setFormData({ ...formData, lon: event.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Материалы карьера</label>
            <div className="max-h-40 overflow-y-auto bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col gap-2">
              {materials.map((material) => {
                const offer = (formData.material_offers || []).find((item) => item.material_id === material.id);
                return (
                  <div key={material.id} className="flex items-center gap-3 p-1">
                    <input
                      type="checkbox"
                      checked={(formData.material_ids || []).includes(material.id)}
                      onChange={() => toggleMaterial(material.id)}
                      className="w-5 h-5 rounded border-slate-300 text-[#2DB0E6] focus:ring-[#2DB0E6]"
                    />
                    <span className="text-sm font-medium text-slate-700">{material.name}</span>
                    {offer ? (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={offer.price ?? ""}
                        onChange={(event) =>
                          setFormData({
                            ...formData,
                            material_offers: (formData.material_offers || []).map((item) =>
                              item.material_id === material.id
                                ? { ...item, price: Number(event.target.value) }
                                : item,
                            ),
                          })
                        }
                        className="ml-auto w-28 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                        placeholder="Цена"
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-slate-700">Фотографии</div>
                <div className="text-xs text-slate-500">
                  {formData.id
                    ? "Можно выбрать несколько файлов"
                    : "Фото будут загружены сразу после сохранения новой точки"}
                </div>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-[#2DB0E6] hover:text-[#2DB0E6]">
                <ImagePlus className="h-4 w-4" />
                Добавить
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []) as File[];
                    event.target.value = "";
                    void handleSelectedFiles(files);
                  }}
                />
              </label>
            </div>

            {(formData.media_files || []).length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {(formData.media_files || []).map((media) => (
                  <div key={media.id} className="group relative aspect-square overflow-hidden rounded-xl bg-slate-200">
                    <img src={media.public_url} alt={media.file_name || "Фотография точки"} className="h-full w-full object-cover" />
                    {media.is_primary ? (
                      <span className="absolute left-2 top-2 rounded-full bg-slate-900/75 px-2 py-1 text-[10px] font-bold text-white">Основное</span>
                    ) : null}
                    <button
                      type="button"
                      aria-label={media.is_primary ? "Главная фотография" : "Сделать главной"}
                      title={media.is_primary ? "Главная фотография" : "Сделать главной"}
                      disabled={media.is_primary || isSaving}
                      onClick={() => void makePointPhotoPrimary(media.id)}
                      className="absolute bottom-2 left-2 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-amber-500 shadow hover:bg-white disabled:cursor-default disabled:bg-amber-100"
                    >
                      <Star className={`h-4 w-4 ${media.is_primary ? "fill-current" : ""}`} />
                    </button>
                    <button
                      type="button"
                      aria-label="Удалить фотографию"
                      onClick={() => void deletePointPhoto(media.id)}
                      className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-rose-600 shadow hover:bg-white"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {pendingFiles.length > 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-4">
                <div className="text-sm font-semibold text-slate-700">Фото в очереди на загрузку</div>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {pendingFiles.map((file, index) => (
                    <div
                      key={`${file.name}-${file.size}-${index}`}
                      className="group relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
                    >
                      {pendingFilePreviews[index] ? (
                        <img
                          src={pendingFilePreviews[index]}
                          alt={file.name}
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                      <span className="absolute inset-x-0 bottom-0 truncate bg-slate-900/70 px-2 py-1 text-[10px] font-semibold text-white">
                        {file.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => removePendingPhoto(index)}
                        aria-label={`Убрать ${file.name}`}
                        className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-white/95 text-rose-600 shadow-sm hover:bg-white hover:text-rose-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {(formData.media_files || []).length === 0 && pendingFiles.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
                Фотографии пока не добавлены
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 rounded-2xl border border-amber-100 bg-amber-50/60 p-4 sm:grid-cols-2">
            <label className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 text-sm font-bold text-slate-800">
              <input
                type="checkbox"
                checked={Boolean(formData.is_vip)}
                onChange={(event) =>
                  setFormData({ ...formData, is_vip: event.target.checked })
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
                value={formData.manual_priority ?? 0}
                onChange={(event) =>
                  setFormData({
                    ...formData,
                    manual_priority: normalizeManualPriority(Number(event.target.value)),
                  })
                }
                className="mt-1 w-full rounded-xl bg-white px-4 py-3 font-normal"
              />
            </label>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={formData.is_active}
                onChange={(event) => setFormData({ ...formData, is_active: event.target.checked })}
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
              <span className="ml-3 text-sm font-medium text-slate-700">Активен</span>
            </label>
          </div>

          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 py-3.5 bg-[#2DB0E6] hover:bg-[#209BD6] text-white rounded-xl font-bold transition-colors disabled:opacity-70 disabled:cursor-not-allowed flex justify-center items-center gap-2"
            >
              {isSaving ? "Сохранение..." : "Сохранить"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
