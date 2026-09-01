import React, { useState } from "react";
import { ArrowLeft, Eye, EyeOff, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

import OtpVerificationStep from "./OtpVerificationStep";
import PasswordResetModal from "./PasswordResetModal";
import { switchAuthenticatedSession } from "./pushAuth";
import { UserRole } from "./store";
import { baseURL, extractApiErrorMessage, formatPhoneNumber } from "./utils";

interface LoginScreenProps {
  onLogin: (role: UserRole) => void;
  onBack: () => void;
  onSelectSupplierRegister: () => void;
  onSelectEquipmentOwnerRegister: () => void;
  onSelectWaterSepticPartnerRegister: () => void;
  onSelectDriverRegister: () => void;
}

const normalizePhoneValue = (value: string) => value.replace(/[\s()-]/g, "");

export default function LoginScreen({
  onLogin,
  onBack,
  onSelectSupplierRegister,
  onSelectEquipmentOwnerRegister,
  onSelectWaterSepticPartnerRegister,
  onSelectDriverRegister,
}: LoginScreenProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [otpStep, setOtpStep] = useState(false);
  const [otpRecipient, setOtpRecipient] = useState("");
  const [otpByEmail, setOtpByEmail] = useState(false);
  const [otpError, setOtpError] = useState("");
  const [isPasswordResetOpen, setIsPasswordResetOpen] = useState(false);

  const handleLoginChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setUsername(event.target.value);
  };

  const submitLogin = async () => {
    const formData = new URLSearchParams();
    formData.append("username", username.includes("@") ? username.trim().toLowerCase() : normalizePhoneValue(username));
    formData.append("password", password);

    const response = await fetch(`${baseURL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(extractApiErrorMessage(data, "Неверный логин или пароль"));
    }

    return data;
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!username || !password) {
      toast.error("Введите логин и пароль");
      return;
    }

    setIsLoading(true);
    setOtpError("");
    try {
      const data = await submitLogin();

      if (data.status === "sms_sent") {
        setOtpRecipient(formatPhoneNumber(data.phone || normalizePhoneValue(username)));
        setOtpStep(true);
        return;
      }
      if (data.status === "email_sent") {
        setOtpRecipient(data.email || username.trim().toLowerCase());
        setOtpByEmail(true);
        setOtpStep(true);
        return;
      }

      await switchAuthenticatedSession(data.access_token, data.role, data.driver_id);
      onLogin(data.role);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось выполнить вход");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyLogin = async (code: string) => {
    setIsLoading(true);
    setOtpError("");
    try {
      const response = await fetch(otpByEmail ? `${baseURL}/auth/email/verify` : `${baseURL}/driver/auth/verify-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(otpByEmail ? { email: otpRecipient, code, auth_scope: "user" } : { phone: normalizePhoneValue(otpRecipient), code }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setOtpError(extractApiErrorMessage(data, "Неверный код"));
        return;
      }

      await switchAuthenticatedSession(data.access_token, data.role, data.driver_id);
      onLogin(data.role);
    } catch (error) {
      setOtpError(error instanceof Error ? error.message : "Сетевая ошибка");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendLoginCode = async () => {
    const data = await submitLogin();
    if (data.status !== (otpByEmail ? "email_sent" : "sms_sent")) {
      throw new Error("Не удалось отправить код повторно");
    }
  };

  return (
    <div className="flex h-screen flex-col bg-white pb-8 text-slate-900 sm:mx-auto sm:max-w-md">
      <div className="flex items-center border-b border-slate-100 px-4 pb-4 pt-[max(env(safe-area-inset-top,16px),1rem)]">
        <button
          onClick={onBack}
          className="-ml-2 rounded-full p-2 transition-colors hover:bg-slate-50"
        >
          <ArrowLeft className="h-6 w-6 text-slate-700" />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center p-6">
        <h1 className="mb-8 text-center text-3xl font-black tracking-tight text-[#2DB0E6]">
          Дармавоз
        </h1>

        {otpStep ? (
          <OtpVerificationStep
            title="Введите код"
            phone={otpRecipient}
            errorText={otpError}
            isSubmitting={isLoading}
            onBack={() => {
              setOtpStep(false);
              setOtpError("");
            }}
            onResend={handleResendLoginCode}
            onVerify={handleVerifyLogin}
          />
        ) : (
          <>
            <form onSubmit={handleLogin} className="flex w-full max-w-sm flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="employee-login" className="text-sm font-medium text-slate-700">
                  Логин или телефон
                </label>
                <input
                  id="employee-login"
                  type="text"
                  name="username"
                  value={username}
                  onChange={handleLoginChange}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 transition-all focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/50"
                  placeholder="Введите логин"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="employee-password" className="text-sm font-medium text-slate-700">
                  Пароль
                </label>
                <div className="relative w-full">
                  <input
                    id="employee-password"
                    type={showPassword ? "text" : "password"}
                    name="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 pr-12 text-slate-900 transition-all focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/50"
                    placeholder="Введите пароль"
                  />
                  <button
                    type="button"
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPasswordResetOpen(true)}
                  className="self-end text-sm font-medium text-blue-500 transition-colors hover:text-blue-700"
                >
                  Забыли пароль?
                </button>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-4 text-lg font-bold text-white shadow-sm transition-all ${
                  isLoading
                    ? "cursor-not-allowed bg-[#2DB0E6]/70"
                    : "bg-[#2DB0E6] hover:bg-[#209BD6] active:bg-[#209BD6]"
                }`}
              >
                {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                {isLoading ? "Вход..." : "Войти"}
              </button>
            </form>

            <div className="mt-8 flex flex-col items-center gap-3 text-center">
              <button
                type="button"
                onClick={onSelectSupplierRegister}
                className="text-sm font-semibold text-[#2DB0E6]"
              >
                Регистрация/вход карьеров и накопителей
              </button>
              <button
                type="button"
                onClick={onSelectEquipmentOwnerRegister}
                className="text-sm font-semibold text-[#2DB0E6]"
              >
                Регистрация/вход спецтехники
              </button>
              <button
                type="button"
                onClick={onSelectDriverRegister}
                className="text-sm font-semibold text-[#2DB0E6]"
              >
                Регистрация самосвалов
              </button>
              <button
                type="button"
                onClick={onSelectWaterSepticPartnerRegister}
                className="text-sm font-semibold text-[#2DB0E6]"
              >
                Регистрация/вход предложений по воде и септику
              </button>
            </div>
          </>
        )}
      </div>
      {isPasswordResetOpen ? <PasswordResetModal onClose={() => setIsPasswordResetOpen(false)} /> : null}
    </div>
  );
}
