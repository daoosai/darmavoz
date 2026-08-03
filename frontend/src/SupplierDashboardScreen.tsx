import { useEffect, useState } from "react";
import { Building2, Loader2, MapPin, Pencil, Plus, Star, Upload } from "lucide-react";
import toast from "react-hot-toast";

import { type MaterialProps } from "./MaterialDetailScreen";
import SupplierCreatePointModal, { type SupplierPoint } from "./SupplierCreatePointModal";
import { baseURL, extractApiErrorMessage } from "./utils";
import {
  PlacementBadge,
  PlacementDates,
  PlacementExpirationWarning,
  shouldShowConfirmationAction,
} from "./placement";

const STATUS_LABELS: Record<string, string> = {
  incomplete: "Черновик",
  pending_moderation: "На модерации",
  approved: "Одобрено",
  rejected: "Отклонено",
  suspended: "Приостановлено",
};

STATUS_LABELS.has_pending_changes = "Есть правки";

const TYPE_LABELS: Record<string, string> = {
  quarry: "Карьер",
  accumulator: "Накопитель",
  warehouse: "База / склад",
  supplier: "Поставщик",
};

const SUPPLIER_DASHBOARD_TEXT = {
  pageTitle: "Мои точки",
  addPoint: "Добавить точку",
  pointPhoto: "Фото",
  editPoint: "Изменить",
  hidePoint: "Скрыть",
  publishPoint: "Опубликовать",
  confirmRelevance: "Подтвердить актуальность",
} as const;

const getPointStatusMeta = (point: SupplierPoint) => {
  if (point.is_active === false || point.moderation_status === "suspended") {
    return { label: "Скрыт", className: "bg-gray-100 text-gray-800" };
  }
  if (point.moderation_status === "pending_moderation") {
    return { label: "На модерации", className: "bg-yellow-100 text-yellow-800" };
  }
  if (point.moderation_status === "has_pending_changes") {
    return { label: "Есть правки", className: "bg-sky-100 text-sky-800" };
  }
  if (point.moderation_status === "approved") {
    return { label: "Одобрено", className: "bg-green-100 text-green-800" };
  }
  if (point.moderation_status === "rejected") {
    return { label: "Отклонено", className: "bg-red-100 text-red-800" };
  }
  return {
    label: STATUS_LABELS[point.moderation_status] || point.moderation_status,
    className: "bg-gray-100 text-gray-800",
  };
};

interface Props {
  token: string;
  onRequireProfile?: () => void;
}

export default function SupplierDashboardScreen({ token, onRequireProfile }: Props) {
  const [points, setPoints] = useState<SupplierPoint[]>([]);
  const [materials, setMaterials] = useState<MaterialProps[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [showCreatePoint, setShowCreatePoint] = useState(false);
  const [editingPoint, setEditingPoint] = useState<SupplierPoint | null>(null);
  const [displayName, setDisplayName] = useState("");

  const getPendingChangesSummary = (point: SupplierPoint) => {
    const pendingChanges = point.pending_changes;
    if (!pendingChanges || typeof pendingChanges !== "object") {
      return null;
    }
    const keys = Object.keys(pendingChanges);
    return keys.length ? keys.join(", ") : null;
  };

  const fetchPoints = async () => {
    try {
      const response = await fetch(`${baseURL}/supplier/points`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => []);
      if (!response.ok) {
        const errorSource =
          data && typeof data === "object" && !Array.isArray(data)
            ? { ...data, status: response.status }
            : { detail: data, status: response.status };
        throw new Error(extractApiErrorMessage(errorSource, "Не удалось загрузить точки"));
      }
      setPoints(Array.isArray(data) ? data : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить точки");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchProfile = async () => {
    try {
      const response = await fetch(`${baseURL}/supplier/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          extractApiErrorMessage(data, "Не удалось загрузить профиль поставщика"),
        );
      }
      setDisplayName(data.display_name || "");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Не удалось загрузить профиль поставщика",
      );
    }
  };

  const fetchMaterials = async () => {
    try {
      const response = await fetch(`${baseURL}/catalog/materials/`);
      const data = await response.json().catch(() => []);
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data, "Не удалось загрузить материалы"));
      }
      const items = Array.isArray(data) ? data : data.results || [];
      setMaterials(items.filter((item: MaterialProps & { is_active?: boolean }) => item.is_active !== false));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить материалы");
    }
  };

  useEffect(() => {
    void fetchPoints();
    void fetchProfile();
    void fetchMaterials();
  }, [token]);

  const openCreatePoint = () => {
    if (displayName.trim()) {
      setShowCreatePoint(true);
      return;
    }
    toast.error("Укажите ваше ФИО в профиле перед добавлением точки");
    onRequireProfile?.();
  };

  const uploadPhoto = async (point: SupplierPoint, file: File) => {
    setIsBusy(true);
    try {
      const isPrimary = !point.media_files?.length;
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };
      const presignResponse = await fetch(`${baseURL}/media/presign-upload`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          file_name: file.name,
          content_type: file.type,
          file_size: file.size,
          entity_type: "quarry",
          entity_id: point.id,
          is_primary: isPrimary,
        }),
      });
      const presign = await presignResponse.json().catch(() => ({}));
      if (!presignResponse.ok) {
        throw new Error(extractApiErrorMessage(presign, "Не удалось подготовить загрузку"));
      }

      const storageResponse = await fetch(presign.upload_url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!storageResponse.ok) {
        throw new Error("Не удалось загрузить фотографию");
      }

      const confirmResponse = await fetch(`${baseURL}/media/confirm`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          entity_type: "quarry",
          entity_id: point.id,
          object_key: presign.object_key,
          file_name: file.name,
          content_type: file.type,
          file_size: file.size,
          is_primary: isPrimary,
        }),
      });
      const confirmed = await confirmResponse.json().catch(() => ({}));
      if (!confirmResponse.ok) {
        throw new Error(extractApiErrorMessage(confirmed, "Не удалось подтвердить фотографию"));
      }

      await fetchPoints();
      toast.success("Фотография добавлена");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить фотографию");
    } finally {
      setIsBusy(false);
    }
  };

  const makePrimaryPhoto = async (mediaId: string) => {
    setIsBusy(true);
    try {
      const response = await fetch(`${baseURL}/media/${mediaId}/make-primary`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          extractApiErrorMessage(data, "Не удалось выбрать главную фотографию"),
        );
      }
      await fetchPoints();
      toast.success("Главная фотография обновлена");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось выбрать главную фотографию");
    } finally {
      setIsBusy(false);
    }
  };

  const submitPoint = async (pointId: string) => {
    setIsBusy(true);
    try {
      const response = await fetch(`${baseURL}/supplier/points/${pointId}/submit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errorSource =
          data && typeof data === "object" && !Array.isArray(data)
            ? { ...data, status: response.status }
            : { detail: data, status: response.status };
        throw new Error(extractApiErrorMessage(errorSource, "Анкета заполнена не полностью"));
      }
      await fetchPoints();
      toast.success("Точка отправлена на модерацию");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отправить точку");
    } finally {
      setIsBusy(false);
    }
  };

  const togglePointVisibility = async (point: SupplierPoint) => {
    setIsBusy(true);
    try {
      const response = await fetch(`${baseURL}/supplier/points/${point.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ is_active: point.is_active === false }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          extractApiErrorMessage(data, "Не удалось изменить статус точки"),
        );
      }
      await fetchPoints();
      toast.success(point.is_active === false ? "Точка опубликована" : "Точка скрыта");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обновить точку");
    } finally {
      setIsBusy(false);
    }
  };

  const confirmPointRelevance = async (point: SupplierPoint) => {
    setIsBusy(true);
    try {
      const response = await fetch(`${baseURL}/supplier/points/${point.id}/confirm-relevance`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось подтвердить актуальность"));
      await fetchPoints();
      toast.success("Актуальность точки подтверждена");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось подтвердить актуальность");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="text-slate-900">
      <header className="px-5 pb-4 pt-[max(env(safe-area-inset-top),1rem)]">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-500">
          Кабинет поставщика
        </p>
        <h1 className="mt-1 text-3xl font-black">{SUPPLIER_DASHBOARD_TEXT.pageTitle}</h1>
      </header>

      <main className="px-5 pb-8">
        <button
          onClick={openCreatePoint}
          className="mt-5 flex w-full items-center justify-center gap-3 rounded-2xl bg-sky-500 px-5 py-5 text-lg font-black text-white shadow-sm hover:bg-sky-600"
        >
          <Plus className="h-6 w-6" />
          {SUPPLIER_DASHBOARD_TEXT.addPoint}
        </button>

        {isLoading ? (
          <Loader2 className="mx-auto mt-16 h-8 w-8 animate-spin text-sky-500" />
        ) : points.length === 0 ? (
          <section className="mt-8 rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
            <Building2 className="mx-auto h-12 w-12 text-slate-300" />
            <h2 className="mt-5 text-xl font-black">Точек пока нет</h2>
            <p className="mt-2 text-sm text-slate-500">
              Добавьте карьер или накопитель. Каждая анкета проходит модерацию отдельно.
            </p>
          </section>
        ) : (
          <div className="mt-8 space-y-4">
            {points.map((point) => (
              <article key={point.id} className="overflow-hidden rounded-3xl bg-white shadow-sm">
                {point.primary_image_url ? (
                  <img src={point.primary_image_url} alt="" className="h-36 w-full object-cover" />
                ) : null}

                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-sky-500">
                        {TYPE_LABELS[point.point_type] || point.point_type}
                      </p>
                      <h2 className="mt-1 text-xl font-black">{point.name}</h2>
                    </div>
                    <span
                      className={`rounded-full px-3 py-2 text-xs font-bold ${getPointStatusMeta(point).className}`}
                    >
                      {getPointStatusMeta(point).label}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2"><PlacementBadge status={point.placement_status} /></div>
                  <div className="mt-3"><PlacementDates item={point} /></div>
                  <PlacementExpirationWarning item={point} className="mt-3" />
                  {point.placement_status === "confirmation_required" ? <p className="mt-3 rounded-2xl bg-orange-50 p-3 text-sm font-semibold text-orange-800">Подтвердите актуальность в течение льготного периода, иначе точка будет скрыта.</p> : null}
                  {point.placement_status === "expired" ? <p className="mt-3 rounded-2xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">Срок размещения завершён. Обратитесь к оператору для продления.</p> : null}

                  <p className="mt-3 flex items-start gap-2 text-sm text-slate-500">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                    {point.address || "Адрес уточняется модератором"}
                  </p>

                  {point.moderation_comment ? (
                    <p className="mt-4 rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">
                      {point.moderation_comment}
                    </p>
                  ) : null}

                  {point.moderation_status === "has_pending_changes" ? (
                    <p className="mt-4 rounded-2xl bg-sky-50 p-3 text-sm text-sky-700">
                      На модерации правки: {getPendingChangesSummary(point) || "есть обновления"}
                    </p>
                  ) : null}

                  {(point.media_files || []).length > 0 ? (
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      {(point.media_files || []).map((media) => (
                        <div key={media.id} className="relative aspect-square overflow-hidden rounded-2xl bg-slate-100">
                          <img
                            src={media.public_url}
                            alt="Фотография точки"
                            className="h-full w-full object-cover"
                          />
                          <button
                            type="button"
                            title={media.is_primary ? "Главная фотография" : "Сделать главной"}
                            aria-label={media.is_primary ? "Главная фотография" : "Сделать главной"}
                            disabled={media.is_primary || isBusy}
                            onClick={() => void makePrimaryPhoto(media.id)}
                            className="absolute bottom-1.5 left-1.5 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-amber-500 shadow disabled:bg-amber-100"
                          >
                            <Star className={`h-4 w-4 ${media.is_primary ? "fill-current" : ""}`} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-5 flex gap-2">
                    <label className="flex flex-1 cursor-pointer items-center justify-center rounded-2xl border border-slate-200 py-3 text-sm font-bold hover:bg-slate-50">
                      <Upload className="mr-2 h-4 w-4" />
                      {SUPPLIER_DASHBOARD_TEXT.pointPhoto}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) =>
                          event.target.files?.[0] && void uploadPhoto(point, event.target.files[0])
                        }
                      />
                    </label>

                    <button
                      onClick={() => setEditingPoint(point)}
                      className="flex flex-1 items-center justify-center rounded-2xl border border-sky-200 bg-sky-50 px-3 py-3 text-sm font-bold text-sky-700 hover:bg-sky-100"
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      {SUPPLIER_DASHBOARD_TEXT.editPoint}
                    </button>

                    {point.moderation_status === "incomplete" ? (
                      <button
                        disabled={isBusy}
                        onClick={() => void submitPoint(point.id)}
                        className="flex-1 rounded-2xl bg-sky-500 px-3 py-3 text-sm font-bold text-white hover:bg-sky-600 disabled:opacity-40"
                      >
                        На модерацию
                      </button>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void togglePointVisibility(point)}
                    className={`mt-3 w-full rounded-2xl px-3 py-3 text-sm font-bold ${
                      point.is_active === false
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-700"
                    } disabled:opacity-50`}
                  >
                    {point.is_active === false
                      ? SUPPLIER_DASHBOARD_TEXT.publishPoint
                      : SUPPLIER_DASHBOARD_TEXT.hidePoint}
                  </button>
                  {shouldShowConfirmationAction(point) ? <button type="button" disabled={isBusy} onClick={() => void confirmPointRelevance(point)} className="mt-3 w-full rounded-2xl bg-orange-50 px-3 py-3 text-sm font-bold text-orange-800 disabled:opacity-50">{SUPPLIER_DASHBOARD_TEXT.confirmRelevance}</button> : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      {showCreatePoint ? (
        <SupplierCreatePointModal
          token={token}
          materials={materials}
          onClose={() => setShowCreatePoint(false)}
          onSaved={(point) => {
            setPoints((current) => [point, ...current]);
            setShowCreatePoint(false);
          }}
        />
      ) : null}

      {editingPoint ? (
        <SupplierCreatePointModal
          token={token}
          point={editingPoint}
          materials={materials}
          onClose={() => setEditingPoint(null)}
          onSaved={(savedPoint) => {
            setPoints((current) =>
              current.map((point) => (point.id === savedPoint.id ? savedPoint : point)),
            );
            setEditingPoint(null);
          }}
        />
      ) : null}
    </div>
  );
}
