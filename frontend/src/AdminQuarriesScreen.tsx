import React, { useState, useEffect } from "react";
import { Plus, Edit2, ImagePlus, Star, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import {
  fetch2gisAddressSuggestions,
  get2gisSuggestionLabel,
  withTyumenBias,
} from "./addressSearch";
import { useAuthStore } from "./store";
import { baseURL, extractApiErrorMessage, formatPhoneNumber } from "./utils";

export interface Quarry {
  id?: string;
  name: string;
  short_name?: string;
  point_type: "quarry" | "accumulator" | "warehouse" | "supplier";
  address: string;
  description?: string;
  contact_phone?: string | null;
  subscription_end_date?: string | null;
  lat: number;
  lon: number;
  min_delivery_price?: number;
  moderation_status?: string;
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

const moderationBadge = (status?: string) =>
  MODERATION_BADGES[status || "incomplete"] || MODERATION_BADGES.incomplete;

const POINT_TYPE_LABELS: Record<Quarry["point_type"], string> = {
  quarry: "Карьер",
  accumulator: "Накопитель",
  warehouse: "Склад",
  supplier: "Поставщик",
};

type EditablePointType = "quarry" | "accumulator";

const normalizeEditablePointType = (value?: Quarry["point_type"]): EditablePointType =>
  value === "accumulator" ? "accumulator" : "quarry";

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

const formatDateInputValue = (value?: string | null) => {
  const parsed = parseSubscriptionEndDate(value);
  return parsed ? parsed.toISOString().slice(0, 10) : "";
};

const serializeSubscriptionEndDate = (value?: string | null) => {
  const parsed = parseSubscriptionEndDate(value);
  return parsed ? parsed.toISOString() : null;
};

const normalizeOptionalText = (value?: string | null) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
};

interface AdminQuarriesScreenProps {
  materials: any[];
}

export default function AdminQuarriesScreen({
  materials,
}: AdminQuarriesScreenProps) {
  const { token } = useAuthStore();
  const [quarries, setQuarries] = useState<Quarry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingQuarry, setEditingQuarry] = useState<Quarry | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [isModerating, setIsModerating] = useState(false);
  const [deletingPointId, setDeletingPointId] = useState<string | null>(null);

  const fetchQuarries = async () => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams();
      if (statusFilter) params.set("moderation_status", statusFilter);
      if (typeFilter) params.set("point_type", typeFilter);
      const res = await fetch(`${baseURL}/admin/pickup-points?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setQuarries(data);
      }
    } catch (e) {
      console.error("Error fetching quarries", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchQuarries();
  }, [statusFilter, typeFilter]);

  const moderatePoint = async (
    pointId: string,
    action: "approve" | "reject",
    reason?: string,
  ) => {
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
      return true;
    } catch {
      toast.error("Не удалось связаться с сервером");
      return false;
    } finally {
      setIsModerating(false);
    }
  };

  const rejectPoint = (pointId: string) => {
    const reason = window.prompt("Укажите причину отклонения:");
    if (!reason?.trim()) return;
    void moderatePoint(pointId, "reject", reason.trim());
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
    } catch {
      toast.error("Не удалось связаться с сервером");
    } finally {
      setDeletingPointId(null);
    }
  };

  const handleOpenModal = (quarry?: Quarry) => {
    if (quarry) {
      setEditingQuarry({
        ...quarry,
        point_type: normalizeEditablePointType(quarry.point_type),
        contact_phone: quarry.contact_phone || quarry.owner_phone || "",
      });
    } else {
      setEditingQuarry({
        name: "",
        point_type: "quarry",
        address: "",
        description: "",
        contact_phone: "",
        subscription_end_date: "",
        lat: 0,
        lon: 0,
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
    <div className="flex flex-col gap-4">
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
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
          <option value="">Все статусы</option>
          <option value="pending_moderation">На модерации</option>
          <option value="approved">Одобрено</option>
          <option value="rejected">Отклонено</option>
          <option value="suspended">Приостановлено</option>
        </select>
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
          <option value="">Все типы</option>
          <option value="quarry">Карьеры</option>
          <option value="accumulator">Накопители</option>
          <option value="warehouse">Склады</option>
          <option value="supplier">Поставщики</option>
        </select>
      </div>

      {/* Desktop View */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden hidden md:block">
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse min-w-[720px]">
            <thead>
              <tr className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider font-bold">
                <th className="p-4 border-b border-slate-100">ID</th>
                <th className="p-4 border-b border-slate-100">Тип</th>
                <th className="p-4 border-b border-slate-100">Название</th>
                <th className="p-4 border-b border-slate-100">Адрес</th>
                <th className="p-4 border-b border-slate-100">Статус</th>
                <th className="p-4 border-b border-slate-100">Модерация</th>
                <th className="p-4 border-b border-slate-100">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {quarries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    Нет точек
                  </td>
                </tr>
              ) : (
                quarries.map((quarry) => (
                  <tr
                    key={quarry.id}
                    className="hover:bg-slate-50/50 transition-colors"
                  >
                    <td className="p-4 text-sm font-medium text-slate-600">
                      #{quarry.id}
                    </td>
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
                      {quarry.is_active ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-bold">
                          Активен
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold">
                          Скрыт
                        </span>
                      )}
                    </td>
                    <td className="p-4">
                      <span className={`inline-flex items-center rounded-lg px-2 py-1 text-xs font-bold ${moderationBadge(quarry.moderation_status).className}`}>
                        {moderationBadge(quarry.moderation_status).label}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => handleOpenModal(quarry)}
                          className="p-2 text-slate-400 hover:text-[#2DB0E6] hover:bg-[#2DB0E6]/10 rounded-xl transition-all"
                        >
                          <Edit2 className="w-5 h-5" />
                        </button>
                        <button
                          type="button"
                          disabled={deletingPointId === quarry.id}
                          onClick={() => void deletePoint(quarry)}
                          className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all disabled:opacity-50"
                          title="Удалить точку"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                        {quarry.moderation_status === "pending_moderation" && quarry.id && (
                          <div className="flex flex-col items-stretch gap-2">
                            <button disabled={isModerating} onClick={() => void moderatePoint(quarry.id!, "approve")} className="w-28 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">Одобрить</button>
                            <button disabled={isModerating} onClick={() => rejectPoint(quarry.id!)} className="w-28 rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50">Отклонить</button>
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
              <div className="flex items-center justify-between gap-2 mt-1">
                <div className="flex flex-wrap gap-2">
                  {quarry.is_active ? (
                    <span className="inline-flex items-center px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-bold">
                      Активен
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold">
                      Скрыт
                    </span>
                  )}
                  <span className={`inline-flex items-center rounded-lg px-2 py-1 text-xs font-bold ${moderationBadge(quarry.moderation_status).className}`}>
                    {moderationBadge(quarry.moderation_status).label}
                  </span>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => handleOpenModal(quarry)}
                    className="p-2 text-slate-400 hover:text-[#2DB0E6] hover:bg-[#2DB0E6]/10 rounded-xl transition-all"
                  >
                    <Edit2 className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    disabled={deletingPointId === quarry.id}
                    onClick={() => void deletePoint(quarry)}
                    className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all disabled:opacity-50"
                    title="Удалить точку"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                  {quarry.moderation_status === "pending_moderation" && quarry.id ? (
                    <div className="flex flex-col items-stretch gap-2">
                      <button disabled={isModerating} onClick={() => void moderatePoint(quarry.id!, "approve")} className="w-28 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 disabled:opacity-50">Одобрить</button>
                      <button disabled={isModerating} onClick={() => rejectPoint(quarry.id!)} className="w-28 rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-50">Отклонить</button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {isModalOpen && editingQuarry && (
        <EditQuarryModal
          quarry={editingQuarry}
          materials={materials}
          onClose={() => setIsModalOpen(false)}
          onSave={() => {
            setIsModalOpen(false);
            fetchQuarries();
          }}
        />
      )}

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
  onSave: () => void;
}) {
  const { token } = useAuthStore();
  const [formData, setFormData] = useState<Quarry>(quarry);
  const [isSaving, setIsSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const usesOwnerPhone = Boolean(formData.owner_user_id);
  const pointTitle =
    formData.point_type === "accumulator" || formData.point_type === "warehouse"
      ? "накопитель"
      : "карьер";

  const mapRef = React.useRef<any>(null);
  const markerRef = React.useRef<any>(null);

  React.useEffect(() => {
    let mapInstance: any = null;

    if ((window as any).mapgl && !mapRef.current) {
      const container = document.getElementById("quarry-map");
      if (container) {
        const initialLon = formData.lon || 65.527202;
        const initialLat = formData.lat || 57.152223;

        mapInstance = new (window as any).mapgl.Map("quarry-map", {
          center: [initialLon, initialLat],
          zoom: 12,
          key: import.meta.env.VITE_2GIS_KEY,
        });

        mapRef.current = mapInstance;

        if (formData.lat && formData.lon) {
          markerRef.current = new (window as any).mapgl.Marker(mapInstance, {
            coordinates: [formData.lon, formData.lat],
          });
        }
      }
    }

    return () => {
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
    if (mapRef.current && formData.lat && formData.lon) {
      const coords: [number, number] = [formData.lon, formData.lat];

      mapRef.current.setCenter(coords);

      if (markerRef.current) {
        markerRef.current.setCoordinates(coords);
      } else {
        markerRef.current = new (window as any).mapgl.Marker(mapRef.current, {
          coordinates: coords,
        });
      }
    }
  }, [formData.lat, formData.lon]);

  const handleLatChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const coordsArray = value.split(/[,\s]+/);
    if (coordsArray.length >= 2) {
      const parsedLat = parseFloat(coordsArray[0]);
      const parsedLon = parseFloat(coordsArray[1]);
      if (!isNaN(parsedLat) && !isNaN(parsedLon)) {
        setFormData((prev) => ({ ...prev, lat: parsedLat, lon: parsedLon }));
        return;
      }
    }
    setFormData((prev) => ({ ...prev, lat: parseFloat(value) || 0 }));
  };

  const fetch2GISSuggests = async (query: string) => {
    return await fetch2gisAddressSuggestions(query);
  };

  const getCoordsFromBackend = async (address: string) => {
    try {
      const res = await fetch(
        `${baseURL}/geo/geocode?address=${encodeURIComponent(withTyumenBias(address))}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (res.ok) {
        const data = await res.json();
        return { lat: data.lat, lon: data.lon };
      }
    } catch (e) {}
    return null;
  };

  const handleAddressChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const val = e.target.value;
    setFormData((prev) => ({ ...prev, address: val }));
    const suggests = await fetch2GISSuggests(val);
    setSuggestions(
      suggests
        .map((s: any) => get2gisSuggestionLabel(s))
        .filter(Boolean),
    );
  };

  const selectSuggestion = async (address: string) => {
    setFormData((prev) => ({ ...prev, address }));
    setSuggestions([]);

    // Auto geocode
    const coords = await getCoordsFromBackend(address);
    if (coords) {
      setFormData((prev) => ({ ...prev, lat: coords.lat, lon: coords.lon }));
    }
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
    const hasCoords =
      formData.lat !== null &&
      formData.lon !== null &&
      !isNaN(formData.lat) &&
      !isNaN(formData.lon);

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
        lat: formData.lat,
        lon: formData.lon,
        is_active: formData.is_active,
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
      onSave();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-3xl w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
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
          className="p-6 overflow-y-auto flex flex-col gap-5"
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

          <div className="grid grid-cols-2 gap-4">
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
                value={formatDateInputValue(formData.subscription_end_date)}
                onChange={(event) =>
                  setFormData({
                    ...formData,
                    subscription_end_date: event.target.value || null,
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
          <div
            id="quarry-map"
            className="w-full h-48 min-h-[192px] bg-gray-200 rounded-xl my-4 overflow-hidden"
          ></div>

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
                      min="0.01"
                      step="0.01"
                      value={offer.price || ""}
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
