import { useState, type FormEvent } from "react";
import { ArrowLeft, Loader2, Phone } from "lucide-react";
import toast from "react-hot-toast";

import OtpVerificationStep from "./OtpVerificationStep";
import { switchAuthenticatedSession } from "./pushAuth";
import type { UserRole } from "./store";
import { baseURL, extractApiErrorMessage, formatPhoneNumber } from "./utils";

export interface EquipmentOwnerRegisterScreenProps {
  onBack: () => void;
  registrationApiPrefix?: string;
  partnerRole?: Extract<UserRole, "equipment_owner" | "water_septic_partner">;
  title?: string;
  description?: string;
}

const normalizePhone = (value: string) => value.replace(/[\s()-]/g, "");

const ERROR_MESSAGES: Record<string, string> = {
  PHONE_ALREADY_USED_BY_ANOTHER_ROLE: "Этот номер уже используется в другом аккаунте",
  EQUIPMENT_OWNER_PHONE_ALREADY_EXISTS: "Владелец спецтехники с таким номером уже существует",
  EQUIPMENT_OWNER_ACCOUNT_DISABLED: "Аккаунт владельца спецтехники отключен",
  WATER_SEPTIC_PARTNER_PHONE_ALREADY_EXISTS: "Партнёр с таким номером уже существует",
  WATER_SEPTIC_PARTNER_ACCOUNT_DISABLED: "Аккаунт партнёра воды и септиков отключен",
  OTP_EXPIRED: "Срок действия кода истек. Запросите новый код",
  INVALID_OTP: "Неверный код подтверждения",
};

const getAuthErrorMessage = (source: unknown, fallbackMessage = "Ошибка авторизации") => {
  const message = extractApiErrorMessage(source, fallbackMessage);
  return ERROR_MESSAGES[message] || message || fallbackMessage;
};

export default function EquipmentOwnerRegisterScreen({
  onBack,
  registrationApiPrefix = "/auth/equipment-owner",
  partnerRole = "equipment_owner",
  title = "Кабинет владельца спецтехники",
  description = "Войдите по номеру телефона. Объявления на спецтехнику ведутся в отдельном кабинете.",
}: EquipmentOwnerRegisterScreenProps) {
  const [phone, setPhone] = useState("");
  const [challengeValue, setChallengeValue] = useState("");
  const [otpError, setOtpError] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const sendCode = async () => {
    const response = await fetch(`${baseURL}${registrationApiPrefix}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: normalizePhone(phone) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(getAuthErrorMessage(data));
    }
    setChallengeValue(data.phone || normalizePhone(phone));
  };

  const handleSendCode = async (event: FormEvent) => {
    event.preventDefault();
    setIsBusy(true);
    try {
      await sendCode();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка авторизации");
    } finally {
      setIsBusy(false);
    }
  };

  const handleResend = async () => {
    try {
      await sendCode();
      toast.success("Код отправлен повторно");
    } catch (error) {
      const message = error instanceof Error ? error.message : getAuthErrorMessage(null);
      setOtpError(message);
      toast.error(message);
    }
  };

  const handleVerify = async (code: string) => {
    setIsBusy(true);
    setOtpError("");
    try {
      const response = await fetch(`${baseURL}${registrationApiPrefix}/register/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: challengeValue, code }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setOtpError(getAuthErrorMessage(data));
        return;
      }
      await switchAuthenticatedSession(data.access_token, partnerRole);
      toast.success("Вход выполнен");
    } catch (error) {
      setOtpError(error instanceof Error ? error.message : "Сетевая ошибка");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 sm:mx-auto sm:max-w-md">
      <header className="flex items-center px-5 pb-4 pt-[max(env(safe-area-inset-top,16px),1rem)]">
        <button
          onClick={onBack}
          className="rounded-full bg-white p-3 text-gray-700 shadow-sm hover:bg-gray-100"
          aria-label="Назад"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
      </header>

      <main className="px-5 pb-10 pt-8">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-500">
          Партнёрам
        </p>
        <h1 className="mt-3 text-4xl font-black leading-tight">
          {title}
        </h1>
        <p className="mt-4 max-w-sm text-gray-500">
          {description}
        </p>

        <section className="mt-10 rounded-2xl bg-white p-6 shadow-sm">
          {challengeValue ? (
            <OtpVerificationStep
              title="Введите код из SMS"
              phone={formatPhoneNumber(challengeValue)}
              errorText={otpError}
              isSubmitting={isBusy}
              onBack={() => {
                setChallengeValue("");
                setOtpError("");
              }}
              onResend={handleResend}
              onVerify={handleVerify}
            />
          ) : (
            <form onSubmit={handleSendCode} className="space-y-5">
              <label className="block text-sm font-bold text-gray-900">
                Номер телефона
                <span className="mt-2 flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 focus-within:border-sky-500">
                  <Phone className="h-5 w-5 text-sky-500" />
                  <input
                    required
                    inputMode="tel"
                    type="tel"
                    value={phone}
                    onChange={(event) => setPhone(formatPhoneNumber(event.target.value))}
                    placeholder="+7 (___) ___-__-__"
                    className="w-full bg-transparent py-4 text-lg outline-none"
                  />
                </span>
              </label>

              <button
                disabled={isBusy || normalizePhone(phone).length < 12}
                className="flex w-full items-center justify-center rounded-xl bg-sky-500 py-4 text-lg font-bold text-white hover:bg-sky-600 disabled:opacity-40"
              >
                {isBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Получить код"}
              </button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
