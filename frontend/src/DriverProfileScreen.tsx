import React, { useState, useEffect } from "react";
import { useAuthStore } from "./store";
import {
  baseURL,
  extractApiErrorMessage,
  formatPhoneNumber,
  handleApiError,
} from "./utils";
import {
  LogOut,
  Truck,
  User as UserIcon,
  Phone,
  Headphones,
  Star,
  AlertCircle,
  Camera,
  Loader2,
  CheckCircle2,
  BadgeCheck,
  Ban,
  ClipboardList,
  X,
} from "lucide-react";
import { NotificationToggle } from "./components/shared/NotificationToggle";
import { logoutCurrentSession } from "./pushAuth";
import UpdateBanner from "./UpdateBanner";
import toast from "react-hot-toast";
import { DriverOrder, DriverOrderCard } from "./DriverOrdersScreen";
import DeleteAccountButton from "./components/shared/DeleteAccountButton";

interface DriverProfile {
  id: string;
  name: string;
  phone: string;
  is_active: boolean;
  dispatch_priority: number;
  moderation_status:
    | "incomplete"
    | "pending_moderation"
    | "approved"
    | "rejected"
    | "suspended"
    | null;
  vehicle_moderation_status?:
    | "pending_moderation"
    | "approved"
    | "rejected"
    | "suspended"
    | null;
  is_on_shift?: boolean;
  vehicle: {
    id: string;
    brand: string;
    plate_number: string;
    vehicle_type: string;
    body_volume_m3?: number;
    cubature_min?: number;
    cubature_max?: number;
    tonnage_min?: number;
    tonnage_max?: number;
    delivery_option_id?: string;
    rate_mode?: "fixed" | "per_ton_km";
    fixed_rate?: number;
    rate_per_ton_km?: number;
    media_files?: any[];
  } | null;
}

export default function DriverProfileScreen({
  onLogout,
  onProfileUpdate,
  hasActiveOrder,
  onOpenSupport,
  isOnShift = false,
  isUpdatingShift = false,
  trackingState = "idle",
  onShiftChange,
}: {
  onLogout: () => void;
  onProfileUpdate?: () => void;
  hasActiveOrder?: boolean;
  onOpenSupport?: () => void;
  isOnShift?: boolean;
  isUpdatingShift?: boolean;
  trackingState?: "idle" | "tracking" | "permission_denied" | "error";
  onShiftChange?: (isOnShift: boolean) => void;
}) {
  const { token } = useAuthStore();
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingSlots, setUploadingSlots] = useState<Record<string, boolean>>(
    {},
  );
  const [localPreviews, setLocalPreviews] = useState<Record<string, string>>(
    {},
  );
  const isDriverInactive = profile?.is_active === false;

  const [status, setStatus] = useState<"available" | "busy" | "offline">("offline");
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const [showHistory, setShowHistory] = useState(false);
  const [historyOrders, setHistoryOrders] = useState<DriverOrder[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const fetchHistory = async () => {
    try {
      setIsLoadingHistory(true);
      const currentToken = useAuthStore.getState().token;
      const res = await fetch(`${baseURL}/driver/orders`, {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const loadedOrders = Array.isArray(data) ? data : data.orders || [];
        setHistoryOrders(
          loadedOrders.filter(
            (o: any) => o.status === "completed" || o.status === "cancelled",
          ),
        );
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, [token]);

  const fetchProfile = async () => {
    try {
      const currentToken = useAuthStore.getState().token;
      if (!currentToken) return;
      const res = await fetch(`${baseURL}/driver/profile/full`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`,
        },
      });
      if (res.status === 401 || res.status === 403) {
        await logoutCurrentSession();
        onLogout();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        const prof = Array.isArray(data) ? data[0] : data;
        setProfile(prof);
        setStatus(hasActiveOrder ? "busy" : prof?.status || "offline");
      }
    } catch (e) {
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (hasActiveOrder) {
      setStatus("busy");
    }
  }, [hasActiveOrder]);

  const handleStatusChange = async (newStatus: "available" | "busy" | "offline") => {
    if (hasActiveOrder && newStatus !== "busy") return;

    try {
      setIsUpdatingStatus(true);
      const currentToken = useAuthStore.getState().token;
      const res = await fetch(`${baseURL}/driver/profile/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.status === 401) {
        await logoutCurrentSession();
        onLogout();
        return;
      }
      if (res.status === 403) {
        toast.error("Недостаточно прав (403)");
        return;
      }
      if (!res.ok) {
        throw new Error("Не удалось обновить статус");
      }

      setStatus(newStatus);
      toast.success("Статус изменен");
      onProfileUpdate?.();
    } catch (error) {
      console.error("Error updating status:", error);
      toast.error("Не удалось обновить статус");
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const statuses = [
    { id: "available", label: "Свободен", dot: "bg-emerald-500" },
    { id: "busy", label: "Занят", dot: "bg-amber-500" },
    { id: "offline", label: "Недоступен", dot: "bg-slate-400" },
  ] as const;

  const handleSubmitForModeration = async () => {
    try {
      setIsSaving(true);
      const currentToken = useAuthStore.getState().token;
      const res = await fetch(`${baseURL}/driver/vehicle/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`,
        },
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if (errData.detail && Array.isArray(errData.detail)) {
          const errMsg = errData.detail
            .map(
              (e: any) => `${e.loc ? e.loc[e.loc.length - 1] : ""}: ${e.msg}`,
            )
            .join(", ");
          throw new Error(errMsg);
        }
        throw new Error(
          extractApiErrorMessage(errData, "Ошибка при отправке на модерацию"),
        );
      }

      const updatedProfile = await res.json();
      setProfile(updatedProfile);
      toast.success("Заявка отправлена на модерацию");
      await fetchProfile();
      onProfileUpdate?.();
    } catch (e: any) {
      toast.error(handleApiError(e, "Ошибка при отправке на модерацию"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleFileUpload = async (file: File, slotId: string) => {
    if (isDriverInactive) {
      toast.error("Ваш профиль не активен, обратитесь к администратору");
      return;
    }
    if (!profile?.vehicle?.id) {
      toast.error("Сначала заполните данные автомобиля!");
      return;
    }

    const localUrl = URL.createObjectURL(file);
    setLocalPreviews((prev) => ({ ...prev, [slotId]: localUrl }));
    setUploadingSlots((prev) => ({ ...prev, [slotId]: true }));

    try {
      const currentToken = useAuthStore.getState().token;
      let fileExt = file.name.includes(".")
        ? file.name.split(".").pop()?.toLowerCase()
        : "";
      if (
        !fileExt ||
        !["jpg", "jpeg", "png", "webp", "gif"].includes(fileExt)
      ) {
        fileExt =
          file.type === "image/png"
            ? "png"
            : file.type === "image/webp"
              ? "webp"
              : "jpg";
      }
      const safeFileName = `photo-${Date.now()}.${fileExt}`;
      const safeContentType =
        file.type || `image/${fileExt === "jpg" ? "jpeg" : fileExt}`;

      // 1: Presign
      const presignRes = await fetch(`${baseURL}/media/presign-upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({
          file_name: safeFileName,
          content_type: safeContentType,
          file_size: file.size,
          entity_type: "vehicle",
          entity_id: profile.vehicle.id,
          is_primary: false,
          sort_order: 0,
          slot_key: slotId,
        }),
      });

      if (presignRes.status === 401 || presignRes.status === 403) {
        toast.error("Ошибка доступа");
        return;
      }
      if (!presignRes.ok) throw new Error("Ошибка Presign");
      const presignData = await presignRes.json();
      if (!presignData.upload_url)
        throw new Error("Бэкенд не вернул upload_url!");

      // 2: Upload
      const uploadRes = await fetch(presignData.upload_url, {
        method: "PUT",
        headers: { "Content-Type": safeContentType },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("Ошибка загрузки в S3");

      // 3: Confirm
      const confirmRes = await fetch(`${baseURL}/media/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({
          entity_type: "vehicle",
          entity_id: profile.vehicle.id,
          object_key: presignData.object_key,
          file_name: safeFileName,
          content_type: safeContentType,
          file_size: file.size,
          is_primary: false,
          sort_order: 0,
          slot_key: slotId,
        }),
      });
      if (!confirmRes.ok) throw new Error("Ошибка подтверждения");

      toast.success("Фото загружено!");
      fetchProfile();
    } catch (error: any) {
      if (error instanceof TypeError && error.message.includes("fetch")) {
        toast.error(
          "Не удалось загрузить фото. Проверьте интернет или отключите VPN.",
        );
      } else {
        toast.error("Сбой при загрузке медиафайла.");
      }
      setLocalPreviews((prev) => {
        const copy = { ...prev };
        delete copy[slotId];
        return copy;
      });
    } finally {
      setUploadingSlots((prev) => ({ ...prev, [slotId]: false }));
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 p-5 bg-slate-50 flex justify-center items-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#2DB0E6]"></div>
      </div>
    );
  }

  const moderationStatus =
    profile?.vehicle_moderation_status ||
    profile?.moderation_status ||
    "incomplete";
  const isReadOnly =
    moderationStatus === "approved" ||
    moderationStatus === "pending_moderation";

  const renderPhotoSlot = (slotKey: string, label: string) => {
    const media = profile?.vehicle?.media_files?.find(
      (m: any) => m.slot_key === slotKey,
    );
    const localUrl = localPreviews[slotKey];
    const isUploading = uploadingSlots[slotKey];
    const imageUrl = localUrl || media?.public_url;

    return (
      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold text-slate-500">{label}</span>
        <label
          className={`relative flex flex-col items-center justify-center h-28 border-2 ${isReadOnly ? "border-transparent cursor-default" : "border-slate-200 border-dashed hover:bg-slate-100 cursor-pointer"} rounded-xl bg-slate-50 transition-colors overflow-hidden group`}
        >
          {isUploading ? (
            <Loader2 className="w-6 h-6 text-[#2DB0E6] animate-spin" />
          ) : imageUrl ? (
            <>
              <img
                src={imageUrl}
                alt={label}
                className="absolute inset-0 w-full h-full object-cover"
              />
              {!isReadOnly && (
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white">
                  <Camera className="w-6 h-6 mb-1" />
                  <span className="text-xs font-bold">Изменить</span>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm mb-2 text-slate-400 group-hover:text-[#2DB0E6] transition-colors">
                <Camera className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-medium text-slate-500 group-hover:text-slate-700">
                Загрузить фото
              </span>
            </>
          )}
          {!isReadOnly && (
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={isReadOnly}
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  handleFileUpload(e.target.files[0], slotKey);
                }
              }}
            />
          )}
        </label>
      </div>
    );
  };

  const hasAllPhotos =
    profile?.vehicle?.media_files &&
    profile.vehicle.media_files.some((m) => m.slot_key === "vehicle_main") &&
    profile.vehicle.media_files.some((m) => m.slot_key === "vehicle_left") &&
    profile.vehicle.media_files.some((m) => m.slot_key === "vehicle_plate");

  const isProfileComplete = hasAllPhotos;

  const getModerationBanner = () => {
    if (isDriverInactive) {
      return (
        <div className="bg-amber-50 border border-amber-100 p-4 rounded-2xl flex items-start gap-3 shadow-sm">
          <AlertCircle className="w-6 h-6 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-bold text-amber-900 leading-tight mb-1">
              Профиль не активен.
            </h3>
            <p className="text-xs text-amber-700 font-medium leading-relaxed">
              Ваш профиль не активен, обратитесь к администратору.
            </p>
          </div>
        </div>
      );
    }
    switch (moderationStatus) {
      case "approved":
        return null;
      case "pending_moderation":
        return (
          <div className="bg-amber-50 border border-amber-100 p-4 rounded-2xl flex items-start gap-3 shadow-sm">
            <AlertCircle className="w-6 h-6 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <h3 className="font-bold text-amber-900 leading-tight mb-1">
                Профиль на проверке.
              </h3>
              <p className="text-xs text-amber-700 font-medium leading-relaxed">
                Вы временно не можете принимать заказы.
              </p>
            </div>
          </div>
        );
      case "incomplete":
        if (hasAllPhotos) return null; // already completed
        return (
          <div className="bg-sky-50 border border-sky-100 p-4 rounded-2xl flex items-start gap-3 shadow-sm">
            <UserIcon className="w-6 h-6 text-sky-500 mt-0.5 shrink-0" />
            <div>
              <h3 className="font-bold text-sky-900 leading-tight mb-1">
                Завершите оформление
              </h3>
              <p className="text-xs text-sky-700 font-medium leading-relaxed">
                Добавьте 3 фото автомобиля для отправки на модерацию.
              </p>
            </div>
          </div>
        );
      case "suspended":
        return (
          <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl flex items-start gap-3 shadow-sm">
            <AlertCircle className="w-6 h-6 text-rose-500 mt-0.5 shrink-0" />
            <div>
              <h3 className="font-bold text-rose-900 leading-tight mb-1">
                Профиль заблокирован.
              </h3>
              <p className="text-xs text-rose-700 font-medium leading-relaxed">
                Ваш профиль был приостановлен администратором.
              </p>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const showModerationBadge = moderationStatus === "pending_moderation";

  if (isLoading) {
    return (
      <div className="flex flex-col min-h-[calc(100vh-80px)] items-center justify-center bg-slate-50 w-full relative">
        <Loader2 className="w-8 h-8 animate-spin text-[#2DB0E6]" />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 bg-slate-50 w-full relative">
      <div className="flex-1 flex flex-col gap-4 p-5 pb-6">
        <UpdateBanner />

        {moderationStatus === "approved" && !isDriverInactive && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-1 rounded-xl border border-slate-100 bg-white p-1 shadow-sm">
              {statuses.map((item) => {
                const isActive = status === item.id;
                const isBlocked = Boolean(hasActiveOrder && item.id !== "busy");
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={isUpdatingStatus || isBlocked}
                    onClick={() => handleStatusChange(item.id)}
                    className={`flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-bold transition-all ${
                      isActive
                        ? "scale-100 bg-slate-100 text-slate-900 shadow-inner"
                        : "scale-95 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                    } ${isUpdatingStatus || isBlocked ? "cursor-not-allowed opacity-50" : ""}`}
                  >
                    <span className={`h-2 w-2 rounded-full ${item.dot} ${isActive ? "animate-pulse" : ""}`} />
                    {item.label}
                  </button>
                );
              })}
            </div>
            {hasActiveOrder && (
              <span className="px-1 text-center text-xs text-red-500">
                Во время активного заказа водитель автоматически занят.
              </span>
            )}
          </div>
        )}

        {moderationStatus === "approved" && !isDriverInactive && isOnShift && (
          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-bold text-slate-900">На смене</h2>
                <p className="mt-1 text-xs font-medium text-slate-500">Передаём геопозицию раз в 15 секунд, пока приложение открыто.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isOnShift}
                aria-label="На смене"
                disabled={isUpdatingShift || !onShiftChange}
                onClick={() => onShiftChange?.(!isOnShift)}
                className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${isOnShift ? "bg-emerald-500" : "bg-slate-300"} ${isUpdatingShift || !onShiftChange ? "cursor-not-allowed opacity-60" : ""}`}
              >
                <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${isOnShift ? "translate-x-7" : "translate-x-1"}`} />
              </button>
            </div>
            {isOnShift && (
              <p className={`mt-3 rounded-xl px-3 py-2 text-xs font-semibold ${trackingState === "tracking" ? "bg-emerald-50 text-emerald-700" : trackingState === "permission_denied" ? "bg-amber-50 text-amber-800" : trackingState === "error" ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-600"}`}>
                {trackingState === "tracking"
                  ? "Геопозиция передаётся. Не закрывайте приложение во время смены."
                  : trackingState === "permission_denied"
                    ? "Разрешите доступ к геопозиции в настройках телефона."
                    : trackingState === "error"
                      ? "Не удалось получить или передать геопозицию. Повторим через 15 секунд."
                      : "Подготавливаем передачу геопозиции…"}
              </p>
            )}
          </div>
        )}

        {getModerationBanner()}

        {showModerationBadge ? (
          <div className="w-full bg-slate-100 text-slate-500 py-12 font-bold rounded-3xl shadow-sm border border-slate-200 text-center flex flex-col items-center justify-center gap-2 mt-4 mb-2">
            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-2 shadow-sm">
              <CheckCircle2 className="w-8 h-8 text-[#2DB0E6]" />
            </div>
            <span className="text-lg text-slate-600">Анкета на проверке</span>
            <span className="text-sm font-medium text-slate-400">
              Ожидайте подтверждения диспетчером
            </span>
          </div>
        ) : moderationStatus === "rejected" ? (
          <div className="flex flex-col items-center justify-center p-10 text-rose-600 text-center mt-4 mb-2 bg-rose-50 rounded-3xl border border-rose-200 shadow-sm">
            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-4 shadow-sm">
              <Ban className="w-10 h-10 text-rose-500" />
            </div>
            <p className="text-xl font-bold text-rose-700 mb-2 leading-tight">
              Профиль отклонен
            </p>
            <p className="text-sm text-rose-600">
              Ваши данные не прошли проверку.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2 p-4 bg-white rounded-2xl shadow-sm h-auto w-full relative">
              <div className="flex justify-between items-start gap-4 mb-2 pb-2 border-b border-slate-50 w-full">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="w-12 h-12 rounded-full overflow-hidden bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <UserIcon className="w-6 h-6 text-slate-400" />
                  </div>
                  <div className="flex flex-col flex-1 min-w-0 w-full">
                    <h2 className="text-lg font-bold text-slate-800 leading-tight truncate break-words w-full">
                      {profile?.name || "Водитель"}
                    </h2>
                    <span className="text-sm font-medium text-slate-500 truncate w-full">
                      {formatPhoneNumber(profile?.phone || "")}
                    </span>
                  </div>
                </div>
                {profile?.moderation_status === "approved" && (
                  <div className="flex-shrink-0 pt-1">
                    <BadgeCheck className="w-8 h-8 text-[#2DB0E6] opacity-30" />
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 text-sm pt-2">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Марка:</span>
                  <span className="font-bold text-slate-800">
                    {profile?.vehicle?.brand ||
                      profile?.vehicle?.brand ||
                      "Не указана"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Госномер:</span>
                  {profile?.vehicle?.plate_number ? (
                    <div className="flex items-stretch bg-white border border-gray-400 rounded-md shadow-sm h-7 overflow-hidden">
                      <div className="flex items-center px-2 text-sm font-bold uppercase tracking-wider text-slate-900 leading-none pt-0.5">
                        {profile.vehicle.plate_number}
                      </div>
                      <div className="flex flex-col items-center justify-center border-l border-gray-400 bg-white h-full px-1.5 py-0.5">
                        <span className="text-[7px] font-bold leading-none text-slate-800 mb-0.5">
                          RUS
                        </span>
                        <svg
                          className="w-4 h-3 rounded-[1px] block"
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 9 6"
                        >
                          <rect fill="#fff" width="9" height="2" />
                          <rect fill="#0039a6" y="2" width="9" height="2" />
                          <rect fill="#d52b1e" y="4" width="9" height="2" />
                        </svg>
                      </div>
                    </div>
                  ) : (
                    <span className="font-mono font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                      Нет
                    </span>
                  )}
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Тип машины:</span>
                  <span className="font-bold text-slate-800">
                    {profile?.vehicle?.vehicle_type ||
                      profile?.vehicle?.vehicle_type ||
                      "Не указан"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Кубатура (м³):</span>
                  <span className="font-bold text-slate-800">
                    {(() => {
                      const min = profile?.vehicle?.cubature_min;
                      const max = profile?.vehicle?.cubature_max;
                      const fallback = profile?.vehicle?.body_volume_m3;
                      if (
                        min !== undefined &&
                        max !== undefined &&
                        min !== null &&
                        max !== null
                      ) {
                        return min === max ? `${min}` : `${min} - ${max}`;
                      }
                      if (min !== undefined && min !== null) return `${min}`;
                      if (max !== undefined && max !== null) return `${max}`;
                      return fallback ? `${fallback}` : "—";
                    })()}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Тоннаж (т):</span>
                  <span className="font-bold text-slate-800">
                    {(() => {
                      const min = profile?.vehicle?.tonnage_min;
                      const max = profile?.vehicle?.tonnage_max;
                      if (
                        min !== undefined &&
                        max !== undefined &&
                        min !== null &&
                        max !== null
                      ) {
                        return min === max ? `${min}` : `${min} - ${max}`;
                      }
                      if (min !== undefined && min !== null) return `${min}`;
                      if (max !== undefined && max !== null) return `${max}`;
                      return "—";
                    })()}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 p-4 bg-white rounded-2xl shadow-sm h-auto w-full relative">
              <div className="flex items-center justify-between mb-3 px-1">
                <h3 className="font-bold text-slate-800">
                  Фотографии автомобиля
                </h3>
                {moderationStatus === "approved" ? (
                  <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-md">
                    <CheckCircle2 className="w-4 h-4" /> Одобрен
                  </span>
                ) : hasAllPhotos ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                ) : null}
              </div>
              {/* Убрали ложное условие на profile.vehicle.id */}
              <div className="grid grid-cols-2 gap-3">
                {renderPhotoSlot("vehicle_main", "Спереди + номер")}
                {renderPhotoSlot("vehicle_left", "Сбоку")}
                {renderPhotoSlot("vehicle_plate", "Только госномер")}
              </div>
            </div>

            {!isReadOnly && (
              <div className="flex flex-col gap-2 mt-4 mb-2">
                {!hasAllPhotos && (
                  <div className="bg-orange-50 text-orange-700 p-4 rounded-2xl border border-orange-200 text-sm font-medium text-center shadow-sm">
                    Загрузите все 3 фото для отправки на модерацию
                  </div>
                )}
                <button
                  onClick={handleSubmitForModeration}
                  disabled={isSaving || isDriverInactive || !isProfileComplete}
                  className={`w-full py-4 font-bold rounded-full shadow-sm transition-all flex items-center justify-center gap-2 ${!isProfileComplete || isDriverInactive || isSaving ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-[#2DB0E6] text-white hover:bg-[#209BD6] active:bg-[#1b8bc2]"}`}
                >
                  {isSaving ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-5 h-5" />
                  )}
                  {isSaving ? "Отправка..." : "Отправить на проверку"}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* History Button & Выход */}
      <div className="mt-auto px-5 flex flex-col gap-3">
        {moderationStatus === "approved" && !isDriverInactive && (
          <button
            onClick={() => {
              setShowHistory(true);
              fetchHistory();
            }}
            className="w-full h-14 bg-white text-slate-700 py-4 font-bold rounded-2xl transition-colors flex items-center justify-center gap-2 border border-slate-200 shadow-sm"
          >
            <ClipboardList className="w-5 h-5 text-slate-500" />
            История заказов
          </button>
        )}
        {onOpenSupport ? (
          <button
            type="button"
            onClick={onOpenSupport}
            className="w-full h-14 bg-white active:bg-slate-50 text-slate-800 font-bold text-lg rounded-2xl flex items-center justify-between px-6 border border-slate-200 shadow-sm"
          >
            <span className="flex items-center gap-3">
              <Headphones className="w-5 h-5 text-sky-500" />
              Поддержка
            </span>
            <span className="text-sky-600 text-sm">Открыть</span>
          </button>
        ) : null}
        <NotificationToggle role="driver" />
        <button
          onClick={async () => {
            try {
              const currentToken = useAuthStore.getState().token;

              await fetch(`${baseURL}/driver/profile/shift`, {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${currentToken}`,
                },
                body: JSON.stringify({ is_on_shift: false }),
              });
            } catch (e) {}
            await logoutCurrentSession();
            onLogout();
          }}
          className="w-full bg-white text-slate-500 hover:text-rose-600 hover:bg-rose-50 py-4 font-bold rounded-2xl transition-colors flex items-center justify-center gap-2 border border-slate-200 shadow-sm"
        >
          <LogOut className="w-5 h-5" />
          Выйти из аккаунта
        </button>
        <DeleteAccountButton
          token={token}
          onDeleted={async () => {
            await logoutCurrentSession();
            onLogout();
          }}
        />
        {/* Распорка для TabBar */}
        <div className="h-32 w-full flex-shrink-0"></div>
      </div>

      {showHistory && (
        <div className="fixed inset-0 z-[99999] bg-slate-900/40 backdrop-blur-sm flex justify-center items-end sm:items-center p-0 sm:p-4">
          <div className="bg-slate-50 w-full sm:max-w-md h-[90vh] sm:h-[80vh] rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col animate-in slide-in-from-bottom-full duration-300">
            <div className="bg-white rounded-t-3xl sm:rounded-t-3xl p-4 flex justify-between items-center border-b border-slate-100 shrink-0 shadow-sm">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <ClipboardList className="w-6 h-6 text-[#2DB0E6]" />
                История заказов
              </h2>
              <button
                onClick={() => setShowHistory(false)}
                className="p-2 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4">
              {isLoadingHistory ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400">
                  <Loader2 className="w-8 h-8 animate-spin mb-3 text-[#2DB0E6]" />
                  <p className="text-sm font-medium">Загрузка истории...</p>
                </div>
              ) : historyOrders.length > 0 ? (
                <div className="flex flex-col gap-4 pb-10">
                  {historyOrders.map((order) => (
                    <DriverOrderCard
                      key={order.id}
                      order={order}
                      isHistory={true}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 text-center">
                  <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                    <ClipboardList className="w-10 h-10 text-slate-300" />
                  </div>
                  <p className="text-base font-semibold text-slate-600 mb-1">
                    История пуста
                  </p>
                  <p className="text-sm">
                    Здесь будут отображаться ваши выполненные заказы.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
