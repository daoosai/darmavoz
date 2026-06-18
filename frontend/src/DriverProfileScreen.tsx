import React, { useState, useEffect } from "react";
import { useAuthStore } from "./store";
import { baseURL, formatPhoneNumber } from "./utils";
import { LogOut, Truck, User as UserIcon, Phone, Star, AlertCircle, Camera, Loader2, CheckCircle2, BadgeCheck, Ban } from "lucide-react";
import UpdateBanner from "./UpdateBanner";
import toast from "react-hot-toast";

interface DriverProfile {
  id: string;
  name: string;
  phone: string;
  is_active: boolean;
  dispatch_priority: number;
  moderation_status: "incomplete" | "pending_moderation" | "approved" | "rejected" | "suspended" | null;
  vehicle_moderation_status?: "pending_moderation" | "approved" | "rejected" | "suspended" | null;
  vehicle: {
    id: string;
    brand: string;
    plate_number: string;
    vehicle_type: string;
    body_volume_m3: number;
    delivery_option_id: string;
    rate_mode: "fixed" | "per_ton_km";
    fixed_rate: number;
    rate_per_ton_km: number;
    media_files?: any[];
  } | null;
}

export default function DriverProfileScreen({ onLogout }: { onLogout: () => void }) {
  const brandOptions = ["КамАЗ", "Shacman", "FAW", "HOWO", "ЗИЛ", "МАЗ", "Volvo", "Scania", "MAN", "DAF", "Другое"];
  const vehicleTypeOptions = ["Самосвал", "Тонар", "Полуприцеп"];
  const { token, logout } = useAuthStore();
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [brand, setBrand] = useState("");
  const [plate, setPlate] = useState("");
  const [vehicleType, setVehicleType] = useState("Самосвал");
  const [deliveryOptionId, setDeliveryOptionId] = useState("");
  const [rateType, setRateType] = useState("per_ton_km");
  const [rateValue, setRateValue] = useState("");
  const [deliveryOptions, setDeliveryOptions] = useState<any[]>([]);
  const [uploadingSlots, setUploadingSlots] = useState<Record<string, boolean>>({});
  const isDriverInactive = profile?.is_active === false;


  useEffect(() => {
    fetchProfile();
    fetchDeliveryOptions();
  }, [token]);

  const fetchDeliveryOptions = async () => {
    try {
      const res = await fetch(`${baseURL}/catalog/delivery-options/`);
      if (res.ok) {
        setDeliveryOptions(await res.json());
      }
    } catch (e) {}
  };

  const fetchProfile = async () => {
    try {
      const currentToken = useAuthStore.getState().token;
      if (!currentToken) return;
      const res = await fetch(`${baseURL}/driver/profile/full`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`
        }
      });
      if (res.status === 401) {
        logout();
        onLogout();
        return;
      }
      if (res.status === 403) {
        // Профиль может возвращать 403, если есть критические ошибки прав.
        return;
      }
      if (!res.ok) {
        throw new Error("Failed to fetch profile");
      }
      const data = await res.json().catch(() => ({}));
      const p = Array.isArray(data) ? data[0] : data;
      setProfile(p);
      
      if (p) {
        setName(p.name || "");
        setPhone(formatPhoneNumber(p.phone) || "");
        if (p.vehicle) {
          setBrand(p.vehicle.brand || "");
          setPlate(p.vehicle.plate_number || "");
          setVehicleType(p.vehicle.vehicle_type || "");
          setDeliveryOptionId(p.vehicle.delivery_option_id || "");
          setRateType(p.vehicle.rate_mode || "per_ton_km");
          if (p.vehicle.rate_mode === "fixed") {
            setRateValue(p.vehicle.fixed_rate?.toString() || "");
          } else {
            setRateValue(p.vehicle.rate_per_ton_km?.toString() || "");
          }
        }
      }
    } catch (error) {
      console.error("Error fetching profile:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitForModeration = async () => {
    setIsSaving(true);
    try {
      const currentToken = useAuthStore.getState().token;
      if (!currentToken) return;
      const res = await fetch(`${baseURL}/driver/vehicle/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`
        }
      });
      if (!res.ok) {
        throw new Error("Failed to submit");
      }
      toast.success("Заявка отправлена на модерацию");
      await fetchProfile();
    } catch (e) {
      toast.error("Не удалось отправить заявку");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    if (isDriverInactive) {
      toast.error("Ваш профиль не активен, обратитесь к администратору");
      return;
    }
    if (!name.trim() || !phone.trim() || !brand.trim() || !plate.trim() || !deliveryOptionId || !vehicleType.trim()) {
      toast.error("Пожалуйста, заполните все обязательные поля");
      return;
    }

    setIsSaving(true);
    try {
      const currentToken = useAuthStore.getState().token;
      
      let sendPhone = phone;
      const digitsOnly = phone.replace(/\D/g, "");
      if (digitsOnly.length === 11) {
        sendPhone = "+" + digitsOnly;
      }
      
      // Update profile
      const profRes = await fetch(`${baseURL}/driver/profile`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`
        },
        body: JSON.stringify({ name, phone: sendPhone })
      });
      if (profRes.status === 401) { logout(); onLogout(); return; }
      if (profRes.status === 403) { toast.error("Недостаточно прав (403)"); return; }

      // Update vehicle
      const rateVal = parseFloat(rateValue) || 0;
      const selectedDeliveryOption = deliveryOptions.find((option) => option.id === deliveryOptionId);
      const vehRes = await fetch(`${baseURL}/driver/vehicle`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + useAuthStore.getState().token
        },
        body: JSON.stringify({
          brand: brand,
          plate_number: plate,
          vehicle_type: vehicleType,
          body_volume_m3: Number(selectedDeliveryOption?.capacity_m3 || 0),
          delivery_option_id: deliveryOptionId || null,
          rate_mode: rateType,
          fixed_rate: rateType === "fixed" ? rateVal : null,
          rate_per_ton_km: rateType === "per_ton_km" ? rateVal : null
        })
      });
      
      if (vehRes.status === 401) { logout(); onLogout(); return; }
      if (vehRes.status === 403) { toast.error("Недостаточно прав (403)"); return; }
      
      if (!profRes.ok || !vehRes.ok) throw new Error("Save status error");

      toast.success("Данные успешно сохранены");
      await fetchProfile(); // refresh data
    } catch (e: any) {
      toast.error("Ошибка сохранения данных");
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
      toast.error("Сначала сохраните данные автомобиля!");
      return;
    }
    setUploadingSlots(prev => ({ ...prev, [slotId]: true }));
    try {
      const currentToken = useAuthStore.getState().token;
      let fileExt = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : '';
      if (!fileExt || !['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(fileExt)) {
        fileExt = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      }
      const safeFileName = `photo-${Date.now()}.${fileExt}`;
      const safeContentType = file.type || `image/${fileExt === 'jpg' ? 'jpeg' : fileExt}`;

      // 1: Presign
      const presignRes = await fetch(`${baseURL}/media/presign-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`
        },
        body: JSON.stringify({
          file_name: safeFileName,
          content_type: safeContentType,
          file_size: file.size,
          entity_type: "vehicle",
          entity_id: profile.vehicle.id,
          is_primary: false,
          sort_order: 0,
          slot_key: slotId
        })
      });

      if (presignRes.status === 401) { logout(); onLogout(); return; }
      if (presignRes.status === 403) { toast.error("Нет доступа к загрузке фото"); return; }
      if (!presignRes.ok) throw new Error("Ошибка Presign");
      const presignData = await presignRes.json();
      if (!presignData.upload_url) throw new Error("Бэкенд не вернул upload_url!");

      // 2: Upload
      const uploadRes = await fetch(presignData.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': safeContentType },
        body: file
      });
      if (!uploadRes.ok) throw new Error("Ошибка загрузки в S3");

      // 3: Confirm
      const confirmRes = await fetch(`${baseURL}/media/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`
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
          slot_key: slotId
        })
      });
      if (!confirmRes.ok) throw new Error("Ошибка подтверждения");

      toast.success("Фото загружено!");
      fetchProfile();
    } catch (e: any) {
      toast.error(e.message || "Ошибка загрузки файла");
    } finally {
      setUploadingSlots(prev => ({ ...prev, [slotId]: false }));
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto p-5 pb-24 bg-slate-50 flex justify-center items-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#2DB0E6]"></div>
      </div>
    );
  }

  const renderPhotoSlot = (slotKey: string, label: string) => {
    const media = profile?.vehicle?.media_files?.find((m: any) => m.slot_key === slotKey);
    const isUploading = uploadingSlots[slotKey];

    return (
      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold text-slate-500">{label}</span>
        <label className="relative flex flex-col items-center justify-center h-28 border-2 border-slate-200 border-dashed rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer overflow-hidden group">
          {isUploading ? (
            <Loader2 className="w-6 h-6 text-[#2DB0E6] animate-spin" />
          ) : media ? (
            <>
              <img src={media.public_url} alt={label} className="absolute inset-0 w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white">
                <Camera className="w-6 h-6 mb-1" />
                <span className="text-xs font-bold">Изменить</span>
              </div>
            </>
          ) : (
            <>
              <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm mb-2 text-slate-400 group-hover:text-[#2DB0E6] transition-colors">
                <Camera className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-medium text-slate-500 group-hover:text-slate-700">Загрузить фото</span>
            </>
          )}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleFileUpload(e.target.files[0], slotKey);
              }
            }}
          />
        </label>
      </div>
    );
  };

  const hasAllPhotos = profile?.vehicle?.media_files && 
                      profile.vehicle.media_files.some(m => m.slot_key === 'vehicle_main') &&
                      profile.vehicle.media_files.some(m => m.slot_key === 'vehicle_left') &&
                      profile.vehicle.media_files.some(m => m.slot_key === 'vehicle_plate');

  const isProfileComplete = 
    !!profile?.vehicle?.brand &&
    !!profile?.vehicle?.plate_number &&
    !!profile?.vehicle?.delivery_option_id &&
    hasAllPhotos;

  const moderationStatus = isProfileComplete
    ? (profile?.vehicle_moderation_status || profile?.moderation_status)
    : "incomplete";

  const getModerationBanner = () => {
    if (isDriverInactive) {
      return (
        <div className="bg-amber-50 border border-amber-100 p-4 rounded-2xl flex items-start gap-3 shadow-sm">
          <AlertCircle className="w-6 h-6 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-bold text-amber-900 leading-tight mb-1">Профиль не активен.</h3>
            <p className="text-xs text-amber-700 font-medium leading-relaxed">Ваш профиль не активен, обратитесь к администратору.</p>
          </div>
        </div>
      );
    }
    switch (moderationStatus) {
      case "approved":
        return null; // hide banner for approved driver
      case "pending_moderation":
        return (
          <div className="bg-amber-50 border border-amber-100 p-4 rounded-2xl flex items-start gap-3 shadow-sm">
            <AlertCircle className="w-6 h-6 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <h3 className="font-bold text-amber-900 leading-tight mb-1">Профиль на проверке. Вы не можете принимать заказы.</h3>
              <p className="text-xs text-amber-700 font-medium leading-relaxed">Диспетчер проверяет ваши данные. Обычно это занимает не больше часа.</p>
            </div>
          </div>
        );
      case "incomplete":
        return (
          <div className="bg-sky-50 border border-sky-100 p-4 rounded-2xl flex items-start gap-3 shadow-sm">
            <UserIcon className="w-6 h-6 text-sky-500 mt-0.5 shrink-0" />
            <div>
              <h3 className="font-bold text-sky-900 leading-tight mb-1">Заполните профиль водителя</h3>
              <p className="text-xs text-sky-700 font-medium leading-relaxed">Добавьте данные автомобиля и 3 фото, затем сохраните изменения.</p>
            </div>
          </div>
        );
      case "suspended":
        return (
          <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl flex items-start gap-3 shadow-sm">
            <AlertCircle className="w-6 h-6 text-rose-500 mt-0.5 shrink-0" />
            <div>
              <h3 className="font-bold text-rose-900 leading-tight mb-1">Профиль заблокирован.</h3>
              <p className="text-xs text-rose-700 font-medium leading-relaxed">Ваш профиль был приостановлен администратором.</p>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const showModerationBadge = moderationStatus === "pending_moderation";

  return (
    <div className="flex-1 overflow-y-auto p-5 pb-32 bg-slate-50 flex flex-col gap-6">
      <UpdateBanner />

      {getModerationBanner()}

      {showModerationBadge ? (
        <div className="w-full bg-slate-100 text-slate-500 py-12 font-bold rounded-2xl shadow-sm border border-slate-200 text-center flex flex-col items-center justify-center gap-2 mt-4 mb-2">
          <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-2 shadow-sm">
            <CheckCircle2 className="w-8 h-8 text-emerald-400" />
          </div>
          <span className="text-lg text-slate-600">Ваш профиль отправлен на модерацию</span>
          <span className="text-sm font-medium text-slate-400">Ожидайте подтверждения администратором</span>
        </div>
      ) : moderationStatus === "rejected" ? (
        <div className="flex flex-col items-center justify-center p-10 text-red-600 text-center mt-4 mb-2 bg-red-50 rounded-3xl border border-red-200 shadow-sm">
          <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-4 shadow-sm">
            <Ban className="w-10 h-10 text-red-500" />
          </div>
          <p className="text-xl font-bold text-red-700 mb-2 leading-tight">
            Профиль заблокирован
          </p>
          <p className="text-sm text-red-600">
            Ваш профиль был отклонен администратором.
          </p>
        </div>
      ) : (
        <>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex flex-col gap-4">
            <h2 className="text-xl font-bold text-slate-800">Личные данные</h2>
        
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1 flex items-center justify-between">
              <span>ФИО</span>
              {profile?.moderation_status === "approved" && (
                <div className="flex items-center gap-1 text-blue-500">
                  <BadgeCheck className="w-4 h-4" />
                </div>
              )}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isDriverInactive}
              className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-semibold text-slate-900 outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] transition-all"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">Телефон</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}
              disabled={isDriverInactive}
              className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-semibold text-slate-900 outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] transition-all"
              placeholder="+7 (999) 000-00-00"
              maxLength={18}
            />
          </div>
        </div>
      </div>

      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex flex-col gap-4">
        <h2 className="text-xl font-bold text-slate-800">Мой автомобиль</h2>
        
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">Марка</label>
            <select
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              disabled={isDriverInactive}
              className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-semibold text-slate-900 outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] transition-all appearance-none"
            >
              <option value="">Выберите марку</option>
              {brandOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">Гос. номер</label>
            <input
              type="text"
              value={plate}
              onChange={(e) => setPlate(e.target.value)}
              disabled={isDriverInactive}
              className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-mono font-black text-slate-900 uppercase pr-8 outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] transition-all"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">Тип машины</label>
            <select
              value={vehicleType}
              onChange={(e) => setVehicleType(e.target.value)}
              disabled={isDriverInactive}
              className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-semibold text-slate-900 outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] transition-all appearance-none"
            >
              <option value="">Выберите тип машины</option>
              {vehicleTypeOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">Кубатура</label>
            <select
              value={deliveryOptionId}
              onChange={(e) => setDeliveryOptionId(e.target.value)}
              disabled={isDriverInactive}
              className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-semibold text-slate-900 outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] transition-all appearance-none"
            >
              <option value="">Выберите кубатуру</option>
              {deliveryOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title} ({option.capacity_m3} м3)
                </option>
              ))}
            </select>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">Тип ставки</label>
              <select
                value={rateType}
                onChange={(e) => setRateType(e.target.value)}
                disabled={isDriverInactive}
                className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-semibold text-slate-900 outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] transition-all appearance-none"
              >
                <option value="per_ton_km">За тонно-км</option>
                <option value="fixed">Фиксированная</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">Значение ставки</label>
              <input
                type="number"
                value={rateValue}
                onChange={(e) => setRateValue(e.target.value)}
                disabled={isDriverInactive}
                className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-semibold text-slate-900 outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] transition-all"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-100">
          <h3 className="font-bold text-slate-800 mb-1">Фотографии (для модерации)</h3>
          {!profile?.vehicle?.id ? (
            <div className="text-sm bg-orange-50 text-orange-700 p-3 rounded-xl border border-orange-100 font-medium my-2">
              Сначала заполните и сохраните данные автомобиля, чтобы загрузить фотографии.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 mt-3">
              {renderPhotoSlot("vehicle_main", "Спереди + номер")}
              {renderPhotoSlot("vehicle_left", "Сбоку")}
              {renderPhotoSlot("vehicle_plate", "Только госномер")}
            </div>
          )}
        </div>
      </div>

          <div className="flex flex-col gap-2 mt-2 mb-2">
            {profile?.vehicle?.id && !hasAllPhotos && (
               <div className="bg-orange-50 text-orange-700 p-3 rounded-xl border border-orange-200 text-sm font-medium text-center shadow-sm">
                 Для отправки на проверку необходимо загрузить 3 фотографии автомобиля
               </div>
            )}
            <button
              onClick={handleSave}
              disabled={isSaving || isDriverInactive}
              className={`w-full ${isProfileComplete ? 'bg-white text-[#2DB0E6] border-2 border-[#2DB0E6] hover:bg-slate-50' : 'bg-[#2DB0E6] text-white hover:bg-[#209BD6]'} py-4 font-bold rounded-2xl shadow-sm active:bg-[#1b8bc2] transition-colors flex items-center justify-center gap-2`}
            >
              {isSaving && <Loader2 className="w-5 h-5 animate-spin" />}
              {isSaving ? "Сохранение..." : "Сохранить изменения"}
            </button>
            <button
              onClick={handleSubmitForModeration}
              disabled={isSaving || isDriverInactive || !isProfileComplete}
              className={`w-full py-4 font-bold rounded-2xl shadow-sm transition-colors flex items-center justify-center gap-2 mt-2 ${!isProfileComplete || isDriverInactive || isSaving ? 'bg-emerald-200 text-emerald-50 cursor-not-allowed' : 'bg-emerald-500 text-white hover:bg-emerald-600 active:bg-emerald-700'}`}
            >
              {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
              {isSaving ? "Отправка..." : "Отправить на модерацию"}
            </button>
          </div>
        </>
      )}

      {/* Выйти кнопка */}
      <div className="mt-2 mb-4">
        <button
          onClick={async () => {
            try {
              const currentToken = useAuthStore.getState().token;
              await fetch(`${baseURL}/driver/profile/status`, {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${currentToken}`
                },
                body: JSON.stringify({ status: "offline" })
              });
            } catch (err) {}
            logout();
            onLogout();
          }}
          className="w-full bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700 py-4 font-bold rounded-2xl transition-colors flex items-center justify-center gap-2 border border-rose-100"
        >
          <LogOut className="w-5 h-5" />
          Выйти из аккаунта
        </button>
      </div>
    </div>
  );
}
