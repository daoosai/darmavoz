import React, { useState, useEffect } from "react";
import { useAuthStore } from "./store";
import { baseURL, formatPhoneNumber, handleApiError } from "./utils";
import {
  LogOut,
  Truck,
  User as UserIcon,
  Phone,
  Star,
  AlertCircle,
  Camera,
  Loader2,
  CheckCircle2,
  BadgeCheck,
  Ban,
} from "lucide-react";
import UpdateBanner from "./UpdateBanner";
import toast from "react-hot-toast";

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
}: {
  onLogout: () => void;
  onProfileUpdate?: () => void;
}) {
  const { token, logout } = useAuthStore();
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
        logout();
        onLogout();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
      }
    } catch (e) {
    } finally {
      setIsLoading(false);
    }
  };

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
          errData.detail ||
            errData.message ||
            "Ошибка при отправке на модерацию",
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

      {/* Выход */}
      <div className="mt-auto px-5">
        <button
          onClick={async () => {
            try {
              const currentToken = useAuthStore.getState().token;

              // Remove FCM token
              await fetch(`${baseURL}/driver/fcm-token`, {
                method: "DELETE",
                headers: {
                  Authorization: `Bearer ${currentToken}`,
                },
              });

              // Set offline status
              await fetch(`${baseURL}/driver/profile/status`, {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${currentToken}`,
                },
                body: JSON.stringify({ status: "offline" }),
              });
            } catch (e) {}
            logout();
            onLogout();
          }}
          className="w-full bg-white text-slate-500 hover:text-rose-600 hover:bg-rose-50 py-4 font-bold rounded-full transition-colors flex items-center justify-center gap-2 border border-slate-200 shadow-sm"
        >
          <LogOut className="w-5 h-5" />
          Выйти из аккаунта
        </button>
        {/* Распорка для TabBar */}
        <div className="h-32 w-full flex-shrink-0"></div>
      </div>
    </div>
  );
}
