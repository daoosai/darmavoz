import React, { useState, useEffect, useRef } from "react";
import { useAuthStore } from "./store";
import { baseURL, formatPhoneNumber } from "./utils";
import { LogOut, Truck, User as UserIcon, Phone, Star, AlertCircle, Camera, Loader2, CheckCircle2 } from "lucide-react";
import UpdateBanner from "./UpdateBanner";
import toast from "react-hot-toast";

interface DriverProfile {
  id: string;
  name: string;
  phone: string;
  dispatch_priority: number;
  moderation_status: "pending_moderation" | "approved" | "rejected" | "suspended" | null;
  vehicle: {
    id: string;
    brand: string;
    model: string;
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
  const { token, logout } = useAuthStore();
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [plate, setPlate] = useState("");
  const [capacity, setCapacity] = useState("");
  const [vehicleType, setVehicleType] = useState("Самосвал");
  const [deliveryOptionId, setDeliveryOptionId] = useState("");
  const [rateType, setRateType] = useState("per_ton_km");
  const [rateValue, setRateValue] = useState("");
  const [deliveryOptions, setDeliveryOptions] = useState<any[]>([]);

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
      if (res.status === 403 || res.status === 401) {
        logout();
        onLogout();
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
          setModel(p.vehicle.model || "");
          setPlate(p.vehicle.plate_number || "");
          setCapacity(p.vehicle.body_volume_m3?.toString() || "");
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

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const currentToken = useAuthStore.getState().token;
      
      let sendPhone = phone;
      const digitsOnly = phone.replace(/\D/g, "");
      if (digitsOnly.length === 11) {
        sendPhone = "+" + digitsOnly;
      }
      
      // Update profile
      await fetch(`${baseURL}/driver/profile`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`
        },
        body: JSON.stringify({ name, phone: sendPhone })
      });

      // Update vehicle
      const rateVal = parseFloat(rateValue) || 0;
      await fetch(`${baseURL}/driver/vehicle`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`
        },
        body: JSON.stringify({
          brand: brand,
          model: model,
          plate_number: plate,
          vehicle_type: vehicleType,
          body_volume_m3: parseFloat(capacity) || 0,
          delivery_option_id: deliveryOptionId || null,
          rate_mode: rateType,
          fixed_rate: rateType === "fixed" ? rateVal : 0,
          rate_per_ton_km: rateType === "per_ton_km" ? rateVal : 0
        })
      });

      toast.success("Данные успешно сохранены");
      await fetchProfile(); // refresh data
    } catch (e: any) {
      toast.error("Ошибка сохранения данных");
    } finally {
      setIsSaving(false);
    }
  };

  const handleFileUpload = async (file: File, slotId: string) => {
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
          slot_key: slotId
        })
      });

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

  const getModerationBanner = () => {
    switch (profile?.moderation_status) {
      case "approved":
        return (
          <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl flex items-start gap-3 shadow-sm">
            <CheckCircle2 className="w-6 h-6 text-emerald-500 mt-0.5 shrink-0" />
            <div>
              <h3 className="font-bold text-emerald-900 leading-tight mb-1">Профиль подтвержден</h3>
              <p className="text-xs text-emerald-700 font-medium leading-relaxed">Вы можете принимать заказы.</p>
            </div>
          </div>
        );
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
      case "rejected":
      case "suspended":
        return (
          <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl flex items-start gap-3 shadow-sm">
            <AlertCircle className="w-6 h-6 text-rose-500 mt-0.5 shrink-0" />
            <div>
              <h3 className="font-bold text-rose-900 leading-tight mb-1">Профиль заблокирован.</h3>
              <p className="text-xs text-rose-700 font-medium leading-relaxed">Ваш профиль был отклонен или заблокирован администратором.</p>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-5 pb-32 bg-slate-50 flex flex-col gap-6">
      <UpdateBanner />

      {getModerationBanner()}

      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex flex-col gap-4">
        <h2 className="text-xl font-bold text-slate-800">Личные данные</h2>
        
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">ФИО</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-semibold text-slate-900 outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] transition-all"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">Телефон</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}
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
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">Марка (напр., КАМАЗ)</label>
            <input
              type="text"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-semibold text-slate-900 outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] transition-all"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">Модель</label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-semibold text-slate-900 outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] transition-all"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">Гос. номер</label>
              <input
                type="text"
                value={plate}
                onChange={(e) => setPlate(e.target.value)}
                className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-mono font-black text-slate-900 uppercase pr-8 outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] transition-all"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">Тип машины / Назначение</label>
            <input
              type="text"
              value={vehicleType}
              onChange={(e) => setVehicleType(e.target.value)}
              className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-semibold text-slate-900 outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] transition-all"
              placeholder="Самосвал, Тонар..."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">Категория (ТС)</label>
              <select
                value={deliveryOptionId}
                onChange={(e) => {
                  setDeliveryOptionId(e.target.value);
                  const opt = deliveryOptions.find(o => o.id === e.target.value);
                  if (opt && opt.volume_m3) setCapacity(opt.volume_m3.toString());
                }}
                className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-semibold text-slate-900 outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] transition-all appearance-none"
              >
                <option value="">Выберите...</option>
                {deliveryOptions.map(o => (
                  <option key={o.id} value={o.id}>{o.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">Точная Кубатура (м³)</label>
              <input
                type="number"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-semibold text-slate-900 outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] transition-all"
              />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">Тип ставки</label>
              <select
                value={rateType}
                onChange={(e) => setRateType(e.target.value)}
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

      <button
        onClick={handleSave}
        disabled={isSaving}
        className="w-full bg-[#2DB0E6] text-white py-4 font-bold rounded-2xl shadow-sm hover:bg-[#209BD6] active:bg-[#1b8bc2] transition-colors flex items-center justify-center gap-2"
      >
        {isSaving && <Loader2 className="w-5 h-5 animate-spin" />}
        {isSaving ? "Сохранение..." : "Сохранить изменения"}
      </button>

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
