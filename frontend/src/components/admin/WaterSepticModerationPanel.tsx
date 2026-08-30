import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  Archive,
  CheckCircle2,
  Loader2,
  ImagePlus,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  Truck,
  X,
  XCircle,
} from "lucide-react";
import toast from "react-hot-toast";

import AddressMapPicker from "../AddressMapPicker";
import CrmPanel from "./CrmPanel";
import ParserRunPanel from "./ParserRunPanel";
import { savePointCrm } from "./savePointCrm";
import { getCrmStatusClass, getCrmStatusLabel, type CrmStatus } from "../../crmStatus";
import {
  baseURL,
  extractApiErrorMessage,
  formatPhoneNumber,
  resolveMediaUrl,
} from "../../utils";

type ManagementTab = "water" | "septic";
type StatusFilter = "all" | "pending_moderation" | "approved" | "suspended";

interface MediaFile {
  id: string;
  public_url: string;
  file_name: string;
  is_primary: boolean;
  sort_order?: number | null;
}

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
  is_free?: boolean;
  price_unit?: string | null;
  description?: string | null;
  primary_image_url?: string | null;
  media_files?: MediaFile[];
  moderation_status: string;
  moderation_comment?: string | null;
  is_active: boolean;
  owner_user_id?: string | null;
  twogis_id?: string | null;
  crm_status?: CrmStatus;
  is_ready?: boolean;
  crm_comment?: string | null;
  parsed_data?: Record<string, unknown> | null;
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
  media_files?: MediaFile[];
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

interface WaterCrmForm {
  status: CrmStatus;
  comment: string;
  ownerId: string;
  initialStatus: CrmStatus;
  initialComment: string;
  initialOwnerId: string;
}

const statusLabel: Record<string, string> = {
  pending_moderation: "На модерации",
  approved: "Одобрено",
  rejected: "Отклонено",
  suspended: "В архиве",
  archived: "В архиве",
};

const normalizeStatus = (status?: string | null) => status?.toLowerCase() || "";

const statusClass = (status?: string | null) => {
  switch (normalizeStatus(status)) {
    case "approved":
      return "bg-green-100 text-green-800";
    case "rejected":
      return "bg-red-100 text-red-800";
    case "suspended":
    case "archived":
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
  phone: formatPhoneNumber(point.phone || ""),
  price: point.price == null ? "" : String(point.price),
  is_free: Boolean(point.is_free),
  price_unit: point.price_unit || "литр",
  description: point.description || "",
});

const createSepticEditForm = (profile: SepticProfile) => ({
  phone: formatPhoneNumber(profile.phone || ""),
  address: profile.address || "",
  lat: String(profile.lat ?? ""),
  lon: String(profile.lon ?? ""),
  tank_volume_m3: String(profile.tank_volume_m3 ?? ""),
  service_price: String(profile.service_price ?? ""),
});

const normalizePhoneForApi = (value: string) => value.replace(/[^\d+]/g, "").trim();

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
  const [createTarget, setCreateTarget] = useState<ManagementTab | null>(null);
  const [editMedia, setEditMedia] = useState<MediaFile[]>([]);
  const [mediaActionId, setMediaActionId] = useState<string | null>(null);
  const [waterEditForm, setWaterEditForm] = useState(() => createWaterEditForm({
    id: "", water_type: "free", source: "", address: "", lat: 0, lon: 0, moderation_status: "", is_active: true,
  }));
  const [waterCrmForm, setWaterCrmForm] = useState<WaterCrmForm>({
    status: "parsed",
    comment: "",
    ownerId: "",
    initialStatus: "parsed",
    initialComment: "",
    initialOwnerId: "",
  });
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
    action: "approve" | "reject" | "suspend" | "restore",
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
            : action === "restore"
              ? "Запись восстановлена из архива"
              : "Запись перенесена в архив",
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обновить запись");
    } finally {
      setActionId(null);
    }
  };

  const deleteWaterPoint = async (point: WaterPoint) => {
    if (!token || !window.confirm("Удалить точку воды безвозвратно?")) return;
    setActionId(point.id);
    try {
      const response = await fetch(`${baseURL}/admin/water-points/${point.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось удалить точку воды"));
      closeEdit();
      toast.success("Точка воды удалена");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить точку воды");
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
    setWaterCrmForm({
      status: point.crm_status || "parsed",
      comment: point.crm_comment || "",
      ownerId: point.owner_user_id || "",
      initialStatus: point.crm_status || "parsed",
      initialComment: point.crm_comment || "",
      initialOwnerId: point.owner_user_id || "",
    });
    setEditMedia(point.media_files || []);
    setEditTarget({ kind: "water", data: point });
  };

  const openSepticEdit = (profile: SepticProfile) => {
    setSepticEditForm(createSepticEditForm(profile));
    setEditMedia(profile.media_files || []);
    setEditTarget({ kind: "septic", data: profile });
  };

  const openCreate = (kind: ManagementTab) => {
    setCreateTarget(kind);
    setEditMedia([]);
    if (kind === "water") {
      setWaterCrmForm({
        status: "parsed",
        comment: "",
        ownerId: "",
        initialStatus: "parsed",
        initialComment: "",
        initialOwnerId: "",
      });
      setWaterEditForm(createWaterEditForm({
        id: "", water_type: "paid", source: "", address: "", lat: 0, lon: 0,
        moderation_status: "", is_active: true, is_free: false,
      }));
      return;
    }
    setSepticEditForm(createSepticEditForm({
      id: "", phone: "", address: "", lat: 0, lon: 0, tank_volume_m3: "", service_price: "",
      moderation_status: "", is_active: true,
    }));
  };

  const closeEdit = () => {
    setEditTarget(null);
    setCreateTarget(null);
    setEditMedia([]);
  };

  const uploadAdminMedia = async (file: File, isPrimary: boolean, sortOrder: number) => {
    if (!token || !editTarget) return;
    const entityType = editTarget.kind === "water" ? "water_point" : "septic_profile";
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    const presignResponse = await fetch(`${baseURL}/media/presign-upload`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        entity_type: entityType,
        entity_id: editTarget.data.id,
        file_name: file.name,
        content_type: file.type,
        file_size: file.size,
        is_primary: isPrimary,
        sort_order: sortOrder,
      }),
    });
    const presign = await presignResponse.json().catch(() => ({}));
    if (!presignResponse.ok) {
      throw new Error(extractApiErrorMessage(presign, "Не удалось подготовить загрузку фото"));
    }

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
        entity_type: entityType,
        entity_id: editTarget.data.id,
        object_key: presign.object_key,
        file_name: file.name,
        content_type: file.type,
        file_size: file.size,
        is_primary: isPrimary,
        sort_order: sortOrder,
      }),
    });
    const confirmed = await confirmResponse.json().catch(() => ({}));
    if (!confirmResponse.ok) {
      throw new Error(extractApiErrorMessage(confirmed, "Не удалось подтвердить загрузку фото"));
    }
    return confirmed.media_file as MediaFile;
  };

  const handleMediaFiles = async (files: FileList | null) => {
    const images = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    setMediaActionId("upload");
    try {
      const uploaded: MediaFile[] = [];
      for (const [index, file] of images.entries()) {
        const media = await uploadAdminMedia(file, editMedia.length === 0 && index === 0, editMedia.length + index);
        if (media) uploaded.push(media);
      }
      setEditMedia((current) => [...current, ...uploaded]);
      toast.success(images.length === 1 ? "Фотография добавлена" : `Добавлено фотографий: ${images.length}`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось добавить фотографии");
    } finally {
      setMediaActionId(null);
    }
  };

  const makeMediaPrimary = async (media: MediaFile) => {
    if (!token) return;
    setMediaActionId(media.id);
    try {
      const response = await fetch(`${baseURL}/media/${media.id}/make-primary`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось выбрать главное фото"));
      setEditMedia((current) => current.map((item) => ({ ...item, is_primary: item.id === media.id })));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось выбрать главное фото");
    } finally {
      setMediaActionId(null);
    }
  };

  const deleteMedia = async (media: MediaFile) => {
    if (!token) return;
    setMediaActionId(media.id);
    try {
      const response = await fetch(`${baseURL}/media/${media.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось удалить фото"));
      setEditMedia((current) => current.filter((item) => item.id !== media.id));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить фото");
    } finally {
      setMediaActionId(null);
    }
  };

  const renderMediaManager = () => {
    const existingPrimaryUrl = editTarget?.data.primary_image_url;
    const hasPrimaryInMedia = editMedia.some((media) => media.public_url === existingPrimaryUrl);
    return (
      <section className="rounded-2xl border border-slate-200 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-slate-900">Фотографии</h4>
            <p className="mt-1 text-xs text-slate-500">Добавляйте, удаляйте и выбирайте главное фото с помощью звезды.</p>
          </div>
          <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700 hover:border-sky-400 hover:text-sky-600">
            <ImagePlus className="h-4 w-4" />Добавить
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              disabled={mediaActionId !== null}
              onChange={(event) => {
                void handleMediaFiles(event.target.files);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>
        {editMedia.length > 0 || existingPrimaryUrl ? (
          <div className="mt-4 grid grid-cols-3 gap-3">
            {editMedia.map((media) => (
              <div key={media.id} className="relative aspect-square overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                <img src={resolveMediaUrl(media.public_url)} alt={media.file_name || "Фотография"} className="h-full w-full object-cover" />
                <button type="button" disabled={media.is_primary || mediaActionId !== null} onClick={() => void makeMediaPrimary(media)} className={`absolute left-2 top-2 rounded-full p-2 shadow-sm disabled:opacity-50 ${media.is_primary ? "bg-amber-400 text-white" : "bg-white/95 text-slate-500"}`} aria-label={media.is_primary ? "Главная фотография" : "Сделать главным фото"} title={media.is_primary ? "Главная фотография" : "Сделать главным фото"}>
                  <Star className="h-4 w-4" fill={media.is_primary ? "currentColor" : "none"} />
                </button>
                <button type="button" disabled={mediaActionId !== null} onClick={() => void deleteMedia(media)} className="absolute right-2 top-2 rounded-full bg-white/95 p-2 text-slate-500 shadow-sm hover:text-rose-600 disabled:opacity-50" aria-label="Удалить фото">
                  <Trash2 className="h-4 w-4" />
                </button>
                {media.is_primary ? <span className="absolute inset-x-0 bottom-0 bg-slate-900/75 px-2 py-1 text-center text-[10px] font-bold text-white">Главное фото</span> : null}
              </div>
            ))}
            {existingPrimaryUrl && !hasPrimaryInMedia ? (
              <div className="relative aspect-square overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                <img src={resolveMediaUrl(existingPrimaryUrl)} alt="Главная фотография" className="h-full w-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 bg-slate-900/75 px-2 py-1 text-center text-[10px] font-bold text-white">Главное фото</span>
              </div>
            ) : null}
          </div>
        ) : <div className="mt-4 rounded-xl border border-dashed border-slate-300 px-3 py-5 text-center text-sm text-slate-500">Фотографии пока не добавлены</div>}
      </section>
    );
  };

  const submitEdit = async (event: FormEvent) => {
    event.preventDefault();
    const targetKind = editTarget?.kind ?? createTarget;
    if (!token || !targetKind) return;
    const isCreating = !editTarget;
    const actionKey = editTarget?.data.id ?? `create-${targetKind}`;
    setActionId(actionKey);
    try {
      const isWater = targetKind === "water";
      const resource = isWater ? "/admin/water-points" : "/admin/septic-providers";
      const payload = isWater
        ? {
            water_type: waterEditForm.water_type,
            name: waterEditForm.name.trim() || null,
            source: waterEditForm.source.trim(),
            address: waterEditForm.address.trim(),
            lat: Number(waterEditForm.lat),
            lon: Number(waterEditForm.lon),
            phone: normalizePhoneForApi(waterEditForm.phone) || null,
            price: waterEditForm.water_type === "paid" ? (waterEditForm.is_free ? 0 : Number(waterEditForm.price)) : null,
            is_free: waterEditForm.is_free,
            price_unit: waterEditForm.water_type === "paid" && !waterEditForm.is_free ? waterEditForm.price_unit.trim() : null,
            description: waterEditForm.description.trim() || null,
          }
        : {
            phone: normalizePhoneForApi(septicEditForm.phone),
            address: septicEditForm.address.trim(),
            lat: Number(septicEditForm.lat),
            lon: Number(septicEditForm.lon),
            tank_volume_m3: Number(septicEditForm.tank_volume_m3),
            service_price: Number(septicEditForm.service_price),
          };
      const response = await fetch(`${baseURL}${resource}${isCreating ? "" : `/${editTarget.data.id}`}`, {
        method: isCreating ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось сохранить изменения"));
      if (!isCreating && isWater && editTarget?.data.id) {
        await savePointCrm({
          token,
          pointKind: "water",
          pointId: editTarget.data.id,
          status: waterCrmForm.status,
          comment: waterCrmForm.comment,
          ownerId: waterCrmForm.ownerId,
          initialStatus: waterCrmForm.initialStatus,
          initialComment: waterCrmForm.initialComment,
          initialOwnerId: waterCrmForm.initialOwnerId,
        });
      }
      if (isCreating) setStatusFilter("all");
      closeEdit();
      toast.success("Изменения сохранены");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить изменения");
    } finally {
      setActionId(null);
    }
  };

  const modalKind = editTarget?.kind ?? createTarget;

  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Вода и септики</h2>
          <p className="mt-1 text-sm text-slate-500">Управление точками воды и профилями септиков</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => openCreate(tab)} className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-bold text-white hover:bg-sky-600">
            <Plus className="h-4 w-4" />{tab === "water" ? "Добавить точку воды" : "Добавить септик"}
          </button>
          <button type="button" onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Обновить
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Тип записей">
        <button type="button" role="tab" aria-selected={tab === "water"} onClick={() => setTab("water")} className={`rounded-lg px-3 py-2 text-sm font-bold transition-colors ${tab === "water" ? "bg-white text-sky-600 shadow-sm" : "text-slate-500"}`}>
          <span className="inline-flex items-center">Точки воды{pendingWaterCount > 0 ? <span className="ml-2 rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">{pendingWaterCount}</span> : null}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "septic"} onClick={() => setTab("septic")} className={`rounded-lg px-3 py-2 text-sm font-bold transition-colors ${tab === "septic" ? "bg-white text-sky-600 shadow-sm" : "text-slate-500"}`}>
          <span className="inline-flex items-center">Септики{pendingSepticCount > 0 ? <span className="ml-2 rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">{pendingSepticCount}</span> : null}</span>
        </button>
      </div>

      {tab === "water" ? <div className="mt-4"><ParserRunPanel target="water" token={token} onCompleted={load} /></div> : null}

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
          const isArchived = status === "suspended" || status === "archived";
          return <article key={point.id} className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
            {point.primary_image_url ? <img src={resolveMediaUrl(point.primary_image_url)} alt={point.name || "Точка воды"} className="h-40 w-full object-cover" /> : null}
            <div className="space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">{point.name || "Точка воды"}</h3></div><div className="flex flex-col items-end gap-1"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(status)}`}>{statusLabel[status] || point.moderation_status}</span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${point.water_type === "free" ? "bg-blue-100 text-blue-800" : "bg-green-100 text-green-800"}`}>{point.water_type === "free" ? "Бесплатная" : "Платная"}</span></div></div><p className="flex gap-2 text-sm text-slate-600"><MapPin className="h-4 w-4 shrink-0" />{point.address}</p>{point.phone ? <p className="flex gap-2 text-sm text-slate-600"><Phone className="h-4 w-4 shrink-0" />{point.phone}</p> : null}{point.description ? <p className="text-sm text-slate-600">{point.description}</p> : null}{point.water_type === "paid" && point.price != null && point.price_unit ? <p className="text-right text-lg font-black text-slate-900">{Number(point.price).toLocaleString("ru-RU")} ₽/{point.price_unit}</p> : null}{point.moderation_comment ? <p className="rounded-xl bg-red-50 p-2 text-sm text-red-700">{point.moderation_comment}</p> : null}{isPending ? <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3"><button type="button" disabled={actionId === point.id} onClick={() => openReject("water", point.id, point.name || "Точка воды")} className="flex items-center justify-center gap-2 rounded-xl border border-rose-200 py-2.5 text-sm font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50"><XCircle className="h-4 w-4" />Отклонить</button><button type="button" disabled={actionId === point.id} onClick={() => void requestAction("water", point.id, "approve")} className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-50">{actionId === point.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Одобрить</button></div> : (isApproved || isArchived) ? <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3"><button type="button" onClick={() => openWaterEdit(point)} className="flex items-center justify-center rounded-xl bg-slate-100 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-200">Редактировать</button><button type="button" disabled={actionId === point.id} onClick={() => void requestAction("water", point.id, isArchived ? "restore" : "suspend")} className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-bold disabled:opacity-50 ${isArchived ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50" : "border-amber-200 text-amber-700 hover:bg-amber-50"}`}>{actionId === point.id ? <Loader2 className="h-4 w-4 animate-spin" /> : isArchived ? <RefreshCw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}{isArchived ? "Восстановить" : "В архив"}</button></div> : null}</div>
             <div className="flex gap-2 border-t border-slate-100 px-4 pb-4 pt-3 text-xs font-bold text-slate-600"><span className={`rounded-full px-2 py-1 ${getCrmStatusClass(point.crm_status)}`}>{getCrmStatusLabel(point.crm_status)}</span><button type="button" disabled={actionId === point.id} onClick={() => void deleteWaterPoint(point)} className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50" aria-label="Удалить точку воды"><Trash2 className="h-4 w-4" /></button></div>
          </article>;
        }) : septicProfiles.map((profile) => {
          const status = normalizeStatus(profile.moderation_status);
          const isPending = status === "pending_moderation";
          const isApproved = status === "approved";
          const isArchived = status === "suspended" || status === "archived";
          return <article key={profile.id} className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
            {profile.primary_image_url ? <img src={resolveMediaUrl(profile.primary_image_url)} alt={profile.address} className="h-40 w-full object-cover" /> : null}
            <div className="space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="rounded-xl bg-cyan-100 p-2.5 text-cyan-600"><Truck className="h-5 w-5" /></span><div><h3 className="font-bold text-slate-900">Откачка септика</h3><p className="mt-1 flex gap-2 text-sm text-slate-600"><Phone className="h-4 w-4 shrink-0" />{profile.phone}</p></div></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(status)}`}>{statusLabel[status] || profile.moderation_status}</span></div><p className="flex gap-2 text-sm text-slate-600"><MapPin className="h-4 w-4 shrink-0" />{profile.address}</p><div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-sm"><p><span className="block text-xs text-slate-400">Цистерна</span><strong>{profile.tank_volume_m3} м³</strong></p><p><span className="block text-xs text-slate-400">Цена услуги</span><strong>{Number(profile.service_price).toLocaleString("ru-RU")} ₽</strong></p></div>{profile.moderation_comment ? <p className="rounded-xl bg-red-50 p-2 text-sm text-red-700">{profile.moderation_comment}</p> : null}{isPending ? <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3"><button type="button" disabled={actionId === profile.id} onClick={() => openReject("septic", profile.id, "Профиль септика")} className="flex items-center justify-center gap-2 rounded-xl border border-rose-200 py-2.5 text-sm font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50"><XCircle className="h-4 w-4" />Отклонить</button><button type="button" disabled={actionId === profile.id} onClick={() => void requestAction("septic", profile.id, "approve")} className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-50">{actionId === profile.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Одобрить</button></div> : (isApproved || isArchived) ? <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3"><button type="button" onClick={() => openSepticEdit(profile)} className="flex items-center justify-center rounded-xl bg-slate-100 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-200">Редактировать</button><button type="button" disabled={actionId === profile.id} onClick={() => void requestAction("septic", profile.id, isArchived ? "restore" : "suspend")} className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-bold disabled:opacity-50 ${isArchived ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50" : "border-amber-200 text-amber-700 hover:bg-amber-50"}`}>{actionId === profile.id ? <Loader2 className="h-4 w-4 animate-spin" /> : isArchived ? <RefreshCw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}{isArchived ? "Восстановить" : "В архив"}</button></div> : null}</div>
          </article>;
        })}
      </div>}

      {rejectTarget ? <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" role="dialog" aria-modal="true"><div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-black text-slate-900">Отклонить заявку?</h3><p className="mt-1 text-sm text-slate-500">{rejectTarget.label}</p></div><button type="button" onClick={() => setRejectTarget(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100" aria-label="Закрыть"><X className="h-5 w-5" /></button></div><label className="mt-4 block text-sm font-bold text-slate-700">Причина отклонения<textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} className="mt-1 min-h-24 w-full rounded-xl border border-slate-200 p-3 font-normal outline-none focus:border-sky-400" placeholder="Опишите, что нужно исправить" /></label><div className="mt-5 grid grid-cols-2 gap-3"><button type="button" onClick={() => setRejectTarget(null)} className="rounded-xl bg-slate-100 py-3 font-bold text-slate-700">Отмена</button><button type="button" disabled={!rejectReason.trim() || actionId === rejectTarget.id} onClick={() => void requestAction(rejectTarget.kind, rejectTarget.id, "reject", rejectReason)} className="rounded-xl bg-rose-500 py-3 font-bold text-white disabled:opacity-50">Отклонить</button></div></div></div> : null}

      {modalKind ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" role="dialog" aria-modal="true">
          <form onSubmit={submitEdit} className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-lg font-black text-slate-900">
                {modalKind === "water" ? (editTarget ? "Редактирование точки воды" : "Добавить точку воды") : (editTarget ? "Редактирование септика" : "Добавить септик")}
              </h3>
              <button type="button" onClick={closeEdit} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100" aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </div>

            {modalKind === "water" ? (
              <div className="mt-4 space-y-3">
                <label className="block text-sm font-bold">Тип воды
                  <select value={waterEditForm.water_type} onChange={(event) => setWaterEditForm((current) => ({ ...current, water_type: event.target.value as "free" | "paid" | "unknown" }))} className="mt-1 w-full rounded-xl border border-slate-200 p-3 font-normal">
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
                {editTarget ? renderMediaManager() : <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">Фотографии можно добавить после сохранения.</p>}
                <label className="block text-sm font-bold">Телефон
                  <input type="tel" inputMode="tel" autoComplete="tel" maxLength={18} value={waterEditForm.phone} onChange={(event) => setWaterEditForm((current) => ({ ...current, phone: formatPhoneNumber(event.target.value) }))} className="mt-1 w-full rounded-xl border border-slate-200 p-3 font-normal" placeholder="+7 (999) 999-99-99" />
                </label>
                {waterEditForm.water_type === "paid" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-sm font-bold">Цена
                      <input required={!waterEditForm.is_free} disabled={waterEditForm.is_free} type="number" min={waterEditForm.is_free ? "0" : "0.01"} step="0.01" value={waterEditForm.is_free ? "0" : waterEditForm.price} onChange={(event) => setWaterEditForm((current) => ({ ...current, price: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 p-3 font-normal disabled:bg-slate-100" />
                      <span className="mt-2 flex items-center gap-2 text-sm font-semibold text-emerald-700">
                        <input type="checkbox" checked={waterEditForm.is_free} onChange={(event) => setWaterEditForm((current) => ({ ...current, is_free: event.target.checked, price: event.target.checked ? "0" : current.price }))} />
                        Бесплатно
                      </span>
                    </label>
                    <label className="text-sm font-bold">Единица
                      <input required={!waterEditForm.is_free} disabled={waterEditForm.is_free} value={waterEditForm.price_unit} onChange={(event) => setWaterEditForm((current) => ({ ...current, price_unit: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 p-3 font-normal disabled:bg-slate-100" />
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
                  <input required type="tel" inputMode="tel" autoComplete="tel" maxLength={18} value={septicEditForm.phone} onChange={(event) => setSepticEditForm((current) => ({ ...current, phone: formatPhoneNumber(event.target.value) }))} className="mt-1 w-full rounded-xl border border-slate-200 p-3 font-normal" placeholder="+7 (999) 999-99-99" />
                </label>
                <AddressMapPicker
                  token={token}
                  inputId="admin-septic-address"
                  address={septicEditForm.address}
                  lat={septicEditForm.lat}
                  lon={septicEditForm.lon}
                  onChange={(location) => setSepticEditForm((current) => ({ ...current, ...location }))}
                />
                {editTarget ? renderMediaManager() : <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">Фотографии можно добавить после сохранения.</p>}
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

            {modalKind === "water" && editTarget ? <CrmPanel
              token={token}
              pointKind="water"
              pointId={editTarget.data.id}
              status={waterCrmForm.status}
              comment={waterCrmForm.comment}
              ownerId={waterCrmForm.ownerId}
              onStatusChange={(status) => setWaterCrmForm((current) => ({ ...current, status }))}
              onCommentChange={(comment) => setWaterCrmForm((current) => ({ ...current, comment }))}
              onOwnerChange={(ownerId) => setWaterCrmForm((current) => ({ ...current, ownerId }))}
            /> : null}

            <div className="mt-5 grid grid-cols-2 gap-3">
              {modalKind === "water" && editTarget ? <button type="button" disabled={actionId === editTarget.data.id} onClick={() => void deleteWaterPoint(editTarget.data as WaterPoint)} className="col-span-2 flex items-center justify-center gap-2 rounded-xl border border-rose-200 py-3 font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50"><Trash2 className="h-4 w-4" />Удалить точку</button> : null}
              <button type="button" onClick={closeEdit} className="rounded-xl bg-slate-100 py-3 font-bold text-slate-700">Отмена</button>
              <button disabled={actionId === (editTarget?.data.id ?? `create-${modalKind}`)} className="flex items-center justify-center rounded-xl bg-sky-500 py-3 font-bold text-white disabled:opacity-50">
                {actionId === (editTarget?.data.id ?? `create-${modalKind}`) ? <Loader2 className="h-5 w-5 animate-spin" /> : "Сохранить"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
