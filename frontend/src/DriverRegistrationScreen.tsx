import React, { useState } from "react";
import { ArrowLeft, Eye, EyeOff, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

import OtpVerificationStep from "./OtpVerificationStep";
import { switchAuthenticatedSession } from "./pushAuth";
import { UserRole } from "./store";
import {
  baseURL,
  extractApiErrorMessage,
  formatPhoneNumber,
  handleApiError,
} from "./utils";

interface DriverRegistrationScreenProps {
  onRegister: (role: UserRole) => void;
  onBack: () => void;
}

export default function DriverRegistrationScreen({
  onRegister,
  onBack,
}: DriverRegistrationScreenProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [vehicleBrand, setVehicleBrand] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [volumeMin, setVolumeMin] = useState("");
  const [volumeMax, setVolumeMax] = useState("");
  const [tonnageMin, setTonnageMin] = useState("");
  const [tonnageMax, setTonnageMax] = useState("");
  const [vehicleType, setVehicleType] = useState("Самосвал");

  const [isLoading, setIsLoading] = useState(false);
  const [otpStep, setOtpStep] = useState(false);
  const [otpPhone, setOtpPhone] = useState("");
  const [otpError, setOtpError] = useState("");

  const normalizePhoneValue = (value: string) => value.replace(/[^\d+]/g, "");

  const buildPayload = () => ({
    name: name.trim(),
    phone: normalizePhoneValue(phone),
    password,
    vehicle_brand: vehicleBrand.trim(),
    vehicle_plate_number: vehiclePlate.trim().toUpperCase(),
    cubature_min: volumeMin ? Number(volumeMin) : null,
    cubature_max: volumeMax ? Number(volumeMax) : null,
    tonnage_min: tonnageMin ? Number(tonnageMin) : null,
    tonnage_max: tonnageMax ? Number(tonnageMax) : null,
    vehicle_type: vehicleType,
  });

  const submitRegistration = async () => {
    const response = await fetch(`${baseURL}/auth/driver/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload()),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const fieldMap: Record<string, string> = {
        password: "Пароль",
        phone: "Телефон",
        name: "ФИО",
        full_name: "ФИО",
        vehicle_plate_number: "Госномер",
        vehicle_brand: "Марка машины",
        cubature_min: "Минимальная кубатура",
        cubature_max: "Максимальная кубатура",
        tonnage_min: "Минимальный тоннаж",
        tonnage_max: "Максимальный тоннаж",
        vehicle_type: "Тип кузова",
      };

      const msgMap: Record<string, string> = {
        "String should have at least 6 characters": "должен содержать не менее 6 символов",
        "String should have at least 1 characters": "обязательное поле для заполнения",
        "Field required": "обязательное поле для заполнения",
        "value is not a valid float": "должно быть числом",
      };

      if (Array.isArray(data.detail)) {
        const errMsg = data.detail
          .map((entry: any) => {
            const field = entry.loc ? entry.loc[entry.loc.length - 1] : "";
            const translatedField = fieldMap[field] || field;
            let translatedMsg = entry.msg;

            for (const [key, value] of Object.entries(msgMap)) {
              if (entry.msg.includes(key)) {
                translatedMsg = value;
                break;
              }
            }

            return `${translatedField}: ${translatedMsg}`;
          })
          .join(", ");
        throw new Error(errMsg);
      }

      throw new Error(extractApiErrorMessage(data, "Ошибка при регистрации"));
    }

    return data;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !name.trim() ||
      !phone.trim() ||
      !password.trim() ||
      !vehicleBrand.trim() ||
      !vehiclePlate.trim()
    ) {
      toast.error("Пожалуйста, заполните все обязательные поля");
      return;
    }

    setIsLoading(true);
    setOtpError("");
    try {
      const data = await submitRegistration();
      if (data.status !== "sms_sent") {
        throw new Error("Сервер не вернул статус отправки кода");
      }

      setOtpPhone(formatPhoneNumber(data.phone || buildPayload().phone));
      setOtpStep(true);
    } catch (error) {
      console.error(error);
      toast.error(handleApiError(error, "Сбой при регистрации"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyRegister = async (code: string) => {
    setIsLoading(true);
    setOtpError("");
    try {
      const response = await fetch(`${baseURL}/driver/auth/verify-register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalizePhoneValue(otpPhone), code }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setOtpError(extractApiErrorMessage(data, "Неверный код"));
        return;
      }

      await switchAuthenticatedSession(data.access_token, data.role || "driver", data.driver_id);
      toast.success("Регистрация успешна!");
      onRegister(data.role || "driver");
    } catch (error) {
      setOtpError(handleApiError(error, "Сбой при подтверждении номера"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendRegisterCode = async () => {
    const data = await submitRegistration();
    if (data.status !== "sms_sent") {
      throw new Error("Не удалось отправить код повторно");
    }
  };

  return (
    <div className="flex flex-col h-screen bg-white text-slate-900 pb-8 sm:max-w-md sm:mx-auto">
      <div className="flex items-center border-b border-slate-100 px-4 pb-4 pt-[max(env(safe-area-inset-top,16px),1rem)] shrink-0">
        <button
          onClick={onBack}
          className="p-2 -ml-2 rounded-full hover:bg-slate-50 transition-colors"
        >
          <ArrowLeft className="w-6 h-6 text-slate-700" />
        </button>
      </div>

      <div className="flex flex-col flex-1 overflow-y-auto px-6 pt-6 pb-24">
        <h1 className="text-3xl font-black text-[#2DB0E6] mb-2 tracking-tight">
          Регистрация
        </h1>
        <h2 className="text-sm font-medium text-slate-500 mb-8 leading-relaxed">
          Создание аккаунта водителя
        </h2>

        {otpStep ? (
          <OtpVerificationStep
            title="Подтвердите номер"
            phone={otpPhone}
            errorText={otpError}
            isSubmitting={isLoading}
            onBack={() => {
              setOtpStep(false);
              setOtpError("");
            }}
            onResend={handleResendRegisterCode}
            onVerify={handleVerifyRegister}
            submitLabel="Завершить регистрацию"
          />
        ) : (
          <form onSubmit={handleSubmit} className="w-full max-w-sm flex flex-col space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">
                ФИО
              </label>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 font-medium focus:outline-none focus:ring-1 focus:ring-[#2DB0E6] focus:border-[#2DB0E6] transition-all"
                placeholder="Иванов Иван Иванович"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">
                Номер телефона
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(event) => setPhone(formatPhoneNumber(event.target.value))}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 font-medium focus:outline-none focus:ring-1 focus:ring-[#2DB0E6] focus:border-[#2DB0E6] transition-all"
                placeholder="+7 (999) 000-00-00"
                maxLength={18}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">
                Пароль
              </label>
              <div className="relative w-full">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 pr-12 text-slate-900 font-medium focus:outline-none focus:ring-1 focus:ring-[#2DB0E6] focus:border-[#2DB0E6] transition-all"
                  placeholder="Придумайте пароль"
                />
                <button
                  type="button"
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div className="w-full h-px bg-slate-100 my-2" />

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">
                Марка машины
              </label>
              <input
                type="text"
                value={vehicleBrand}
                onChange={(event) => setVehicleBrand(event.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 font-medium focus:outline-none focus:ring-1 focus:ring-[#2DB0E6] focus:border-[#2DB0E6] transition-all"
                placeholder="Например, КАМАЗ"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">
                Госномер
              </label>
              <input
                type="text"
                value={vehiclePlate}
                onChange={(event) => setVehiclePlate(event.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 font-bold uppercase focus:outline-none focus:ring-1 focus:ring-[#2DB0E6] focus:border-[#2DB0E6] transition-all"
                placeholder="А000АА77"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">
                Тип машины
              </label>
              <select
                value={vehicleType}
                onChange={(event) => setVehicleType(event.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 font-medium focus:outline-none focus:ring-1 focus:ring-[#2DB0E6] focus:border-[#2DB0E6] transition-all appearance-none"
              >
                <option value="Самосвал">Самосвал</option>
                <option value="Бортовой">Бортовой</option>
                <option value="Будка">Будка</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5 w-full">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">
                  Кубатура (м3)
                </label>
                <div className="grid grid-cols-2 gap-2 w-full overflow-hidden">
                  <input
                    type="number"
                    value={volumeMin}
                    onChange={(event) => setVolumeMin(event.target.value)}
                    className="w-full min-w-0 bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-slate-900 font-medium focus:outline-none focus:ring-1 focus:ring-[#2DB0E6] focus:border-[#2DB0E6] transition-all"
                    placeholder="От"
                  />
                  <input
                    type="number"
                    value={volumeMax}
                    onChange={(event) => setVolumeMax(event.target.value)}
                    className="w-full min-w-0 bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-slate-900 font-medium focus:outline-none focus:ring-1 focus:ring-[#2DB0E6] focus:border-[#2DB0E6] transition-all"
                    placeholder="До"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5 w-full">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">
                  Тоннаж (т)
                </label>
                <div className="grid grid-cols-2 gap-2 w-full overflow-hidden">
                  <input
                    type="number"
                    value={tonnageMin}
                    onChange={(event) => setTonnageMin(event.target.value)}
                    className="w-full min-w-0 bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-slate-900 font-medium focus:outline-none focus:ring-1 focus:ring-[#2DB0E6] focus:border-[#2DB0E6] transition-all"
                    placeholder="От"
                  />
                  <input
                    type="number"
                    value={tonnageMax}
                    onChange={(event) => setTonnageMax(event.target.value)}
                    className="w-full min-w-0 bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-slate-900 font-medium focus:outline-none focus:ring-1 focus:ring-[#2DB0E6] focus:border-[#2DB0E6] transition-all"
                    placeholder="До"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full text-white rounded-full py-4 font-bold text-lg mt-6 shadow-sm transition-all flex items-center justify-center gap-2 ${
                isLoading
                  ? "bg-[#2DB0E6]/70 cursor-not-allowed"
                  : "bg-[#2DB0E6] active:bg-[#209BD6] hover:bg-[#209BD6]"
              }`}
            >
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              {isLoading ? "Регистрация..." : "Зарегистрироваться"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
