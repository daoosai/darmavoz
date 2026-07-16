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
  onSelectSupplier?: () => void;
}

const normalizePhoneValue = (value: string) => value.replace(/[\s()-]/g, "");
const normalizeEmailValue = (value: string) => value.trim().toLowerCase();
const isValidEmail = (value: string) => /\S+@\S+\.\S+/.test(normalizeEmailValue(value));

export default function LoginScreen({ onLogin, onBack, onSelectSupplier }: LoginScreenProps) {
  const [authMode, setAuthMode] = useState<"credentials" | "email">("credentials");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [otpStep, setOtpStep] = useState(false);
  const [otpRecipient, setOtpRecipient] = useState("");
  const [otpError, setOtpError] = useState("");

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

  const sendEmailCode = async () => {
    const normalizedEmail = normalizeEmailValue(email);
    const response = await fetch(`${baseURL}/auth/email/send-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: normalizedEmail, auth_scope: "user" }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(extractApiErrorMessage(data, "Не удалось отправить код"));
    }

    return { ...data, email: normalizedEmail };
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();

    if (authMode === "credentials") {
      if (!username || !password) {
        toast.error("Введите логин и пароль");
        return;
      }
    } else if (!isValidEmail(email)) {
      toast.error("Введите корректный email");
      return;
    }

    setIsLoading(true);
    setOtpError("");
    try {
      const data = authMode === "credentials" ? await submitLogin() : await sendEmailCode();
      if (authMode === "email") {
        setOtpRecipient(data.email);
        setOtpStep(true);
        return;
      }

      if (data.status === "sms_sent") {
        setOtpRecipient(formatPhoneNumber(data.phone || normalizePhoneValue(username)));
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
      const response = await fetch(
        authMode === "email" ? `${baseURL}/auth/email/verify` : `${baseURL}/driver/auth/verify-login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body:
            authMode === "email"
              ? JSON.stringify({ email: normalizeEmailValue(otpRecipient), code, auth_scope: "user" })
              : JSON.stringify({ phone: normalizePhoneValue(otpRecipient), code }),
        },
      );
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
    if (authMode === "email") {
      await sendEmailCode();
      return;
    }

    const data = await submitLogin();
    if (data.status !== "sms_sent") {
      throw new Error("Не удалось отправить код повторно");
    }
  };

  return (
    <div className="flex h-screen flex-col bg-white pb-8 text-slate-900 sm:mx-auto sm:max-w-md">
      <div className="flex items-center border-b border-slate-100 p-4">
        <button
          onClick={onBack}
          className="rounded-full p-2 -ml-2 transition-colors hover:bg-slate-50"
        >
          <ArrowLeft className="h-6 w-6 text-slate-700" />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center p-6">
        <h1 className="mb-2 text-center text-3xl font-black tracking-tight text-[#2DB0E6]">
          Дармавоз
        </h1>
        <h2 className="mb-8 text-center text-lg font-medium text-slate-500">
          Сотрудники
        </h2>

        {otpStep ? (
          <OtpVerificationStep
            title={authMode === "email" ? "Введите код из письма" : "Введите код"}
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
          <form onSubmit={handleLogin} className="flex w-full max-w-sm flex-col gap-4">
            {authMode === "credentials" ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="employee-login" className="text-sm font-medium text-slate-700">
                    Логин или Телефон
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
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="employee-email" className="text-sm font-medium text-slate-700">
                  Электронная почта
                </label>
                <input
                  id="employee-email"
                  type="email"
                  name="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 transition-all focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/50"
                  placeholder="name@example.com"
                />
              </div>
            )}

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
              {isLoading ? (authMode === "email" ? "Отправка..." : "Вход...") : authMode === "email" ? "Получить код" : "Войти"}
            </button>

            <button
              type="button"
              onClick={() => {
                setAuthMode((current) => (current === "credentials" ? "email" : "credentials"));
                setOtpError("");
              }}
              className="text-sm font-semibold text-[#187fac] underline decoration-[#2DB0E6]/40 underline-offset-4"
            >
              {authMode === "credentials" ? "Войти через электронную почту" : "Войти по номеру телефона"}
            </button>

            {onSelectSupplier ? (
              <button
                type="button"
                onClick={onSelectSupplier}
                className="mt-2 text-sm font-semibold text-[#187fac] underline decoration-[#2DB0E6]/40 underline-offset-4"
              >
                Стать поставщиком (Владельцам карьеров)
              </button>
            ) : null}
          </form>
        )}
      </div>
    </div>
  );
}
