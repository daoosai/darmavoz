import React, { useState } from "react";
import { ArrowLeft, Eye, EyeOff, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

import OtpVerificationStep from "./OtpVerificationStep";
import { switchAuthenticatedSession } from "./pushAuth";
import { UserRole } from "./store";
import { baseURL, extractApiErrorMessage, formatPhoneNumber } from "./utils";

interface LoginScreenProps {
  onLogin: (role: UserRole) => void;
  onBack: () => void;
}

export default function LoginScreen({ onLogin, onBack }: LoginScreenProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [otpStep, setOtpStep] = useState(false);
  const [otpPhone, setOtpPhone] = useState("");
  const [otpError, setOtpError] = useState("");

  const normalizePhoneValue = (value: string) => value.replace(/[\s()-]/g, "");

  const handleLoginChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    if (/^[\d+()\-\s]*$/.test(value) && value !== "") {
      if (value === "+") {
        setUsername("+");
        return;
      }
      setUsername(formatPhoneNumber(value));
      return;
    }
    setUsername(value);
  };

  const submitLogin = async () => {
    const formData = new URLSearchParams();
    formData.append("username", normalizePhoneValue(username));
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
        setOtpPhone(formatPhoneNumber(data.phone || normalizePhoneValue(username)));
        setOtpStep(true);
        return;
      }

      await switchAuthenticatedSession(data.access_token, data.role, data.driver_id);
      onLogin(data.role);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Неверный логин или пароль");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyLogin = async (code: string) => {
    setIsLoading(true);
    setOtpError("");
    try {
      const response = await fetch(`${baseURL}/driver/auth/verify-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalizePhoneValue(otpPhone), code }),
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
    if (data.status !== "sms_sent") {
      throw new Error("Не удалось отправить код повторно");
    }
  };

  return (
    <div className="flex flex-col h-screen bg-white text-slate-900 pb-8 sm:max-w-md sm:mx-auto">
      <div className="flex items-center p-4 border-b border-slate-100">
        <button
          onClick={onBack}
          className="p-2 -ml-2 rounded-full hover:bg-slate-50 transition-colors"
        >
          <ArrowLeft className="w-6 h-6 text-slate-700" />
        </button>
      </div>

      <div className="flex flex-col flex-1 items-center justify-center p-6">
        <h1 className="text-3xl font-black text-[#2DB0E6] mb-2 tracking-tight text-center">
          Дармавоз
        </h1>
        <h2 className="text-lg font-medium text-slate-500 mb-8 text-center">
          Сотрудники
        </h2>

        {otpStep ? (
          <OtpVerificationStep
            title="Введите код"
            phone={otpPhone}
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
          <form onSubmit={handleLogin} className="w-full max-w-sm flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">
                Логин или Телефон
              </label>
              <input
                type="text"
                name="username"
                value={username}
                onChange={handleLoginChange}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/50 transition-all"
                placeholder="Введите логин"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">Пароль</label>
              <div className="relative w-full">
                <input
                  type={showPassword ? "text" : "password"}
                  name="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 pr-12 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/50 transition-all"
                  placeholder="Введите пароль"
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

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full text-white rounded-xl py-4 font-bold text-lg mt-4 shadow-sm transition-all flex items-center justify-center gap-2 ${
                isLoading
                  ? "bg-[#2DB0E6]/70 cursor-not-allowed"
                  : "bg-[#2DB0E6] active:bg-[#209BD6] hover:bg-[#209BD6]"
              }`}
            >
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              {isLoading ? "Вход..." : "Войти"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
