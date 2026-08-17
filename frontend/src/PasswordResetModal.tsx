import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Eye, EyeOff, Loader2, LockKeyhole, Mail, Phone, ShieldCheck, X } from "lucide-react";
import toast from "react-hot-toast";

import { baseURL, extractApiErrorMessage, formatPhoneNumber } from "./utils";

type ResetMethod = "email" | "phone";
type ResetStep = "request" | "otp" | "password";
type ResetAccount = { role: string; name?: string | null; email?: string | null; phone?: string | null };

const normalizePhone = (value: string) => value.replace(/[^\d+]/g, "");

export default function PasswordResetModal({ onClose }: { onClose: () => void }) {
  const [method, setMethod] = useState<ResetMethod>("email");
  const [step, setStep] = useState<ResetStep>("request");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showRepeatPassword, setShowRepeatPassword] = useState(false);
  const [resetAccount, setResetAccount] = useState<ResetAccount | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);

  const sendResetCode = async () => {
    const target = method === "email" ? email.trim().toLowerCase() : normalizePhone(phone);
    if (!target) {
      toast.error(method === "email" ? "Введите email" : "Введите номер телефона");
      return false;
    }
    if (method === "phone" && target.length !== 12) {
      toast.error("Введите номер в формате +7 (XXX) XXX-XX-XX");
      return false;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(
        `${baseURL}${method === "email" ? "/auth/password-reset/request" : "/auth/forgot-password/phone"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(method === "email" ? { email: target } : { phone: target }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data, "Не удалось отправить код"));
      }

      if (method === "email") {
        setEmail(target);
      } else {
        setPhone(formatPhoneNumber(target));
      }
      setCode("");
      setResendSeconds(30);
      toast.success(method === "email" ? "Код отправлен на email" : "Код отправлен по SMS");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отправить код");
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const requestResetCode = async (event: FormEvent) => {
    event.preventDefault();
    if (await sendResetCode()) {
      setStep("otp");
    }
  };

  const resendResetCode = async () => {
    if (resendSeconds > 0 || isSubmitting) {
      return;
    }
    await sendResetCode();
  };

  useEffect(() => {
    if (step !== "otp" || resendSeconds <= 0) {
      return;
    }

    const timerId = window.setInterval(() => {
      setResendSeconds((seconds) => Math.max(seconds - 1, 0));
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [resendSeconds, step]);

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim()) {
      toast.error(method === "email" ? "Введите код из письма" : "Введите код из SMS");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(
        `${baseURL}${method === "email" ? "/auth/password-reset/verify" : "/auth/forgot-password/verify-phone"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            method === "email"
              ? { email, code: code.trim() }
              : { phone: normalizePhone(phone), code: code.trim() },
          ),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.reset_token) {
        throw new Error(extractApiErrorMessage(data, "Неверный или истёкший код"));
      }

      setResetToken(data.reset_token);
      setResetAccount(
        typeof data.role === "string"
          ? {
              role: data.role,
              name: typeof data.name === "string" ? data.name : null,
              email: typeof data.email === "string" ? data.email : null,
              phone: typeof data.phone === "string" ? data.phone : null,
            }
          : null,
      );
      setStep("password");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось проверить код");
    } finally {
      setIsSubmitting(false);
    }
  };

  const completeReset = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 8) {
      toast.error("Пароль должен содержать не менее 8 символов");
      return;
    }
    if (newPassword !== passwordConfirmation) {
      toast.error("Пароли не совпадают");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(
        `${baseURL}${method === "email" ? "/auth/password-reset/complete" : "/auth/forgot-password/reset-phone"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            method === "email"
              ? { reset_token: resetToken, new_password: newPassword }
              : { phone: normalizePhone(phone), reset_token: resetToken, new_password: newPassword },
          ),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data, "Не удалось обновить пароль"));
      }
      toast.success("Пароль обновлён. Теперь можно войти.");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обновить пароль");
    } finally {
      setIsSubmitting(false);
    }
  };

  const recipient = method === "email" ? email : formatPhoneNumber(phone);
  const stepMeta: Record<ResetStep, { title: string; description: string }> = {
    request: {
      title: "Восстановление пароля",
      description: method === "email"
        ? "Укажите email учётной записи администратора или логиста."
        : "Укажите номер телефона, привязанный к вашему аккаунту.",
    },
    otp: {
      title: "Введите код",
      description: `Мы отправили код ${method === "email" ? "на" : "по SMS на"} ${recipient}.`,
    },
    password: { title: "Новый пароль", description: "Придумайте новый пароль для входа." },
  };
  const currentMeta = stepMeta[step];
  const resetRoleLabel = resetAccount?.role === "admin"
    ? "Администратор"
    : resetAccount?.role === "logist"
      ? "Логист"
      : resetAccount?.role === "driver"
        ? "Водитель"
        : resetAccount?.role === "supplier"
          ? "Поставщик"
          : resetAccount?.role;
  const resetAccountIdentifier = resetAccount?.phone
    ? formatPhoneNumber(resetAccount.phone)
    : resetAccount?.email || recipient;
  const steps: ResetStep[] = ["request", "otp", "password"];

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="password-reset-title">
      <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="password-reset-title" className="text-xl font-black text-slate-900">{currentMeta.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{currentMeta.description}</p>
            {step === "password" && resetAccountIdentifier && resetRoleLabel ? <p className="mt-2 text-sm text-slate-500">Аккаунт: {resetAccountIdentifier} <span aria-hidden="true">|</span> Роль: {resetRoleLabel}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100" aria-label="Закрыть"><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2" aria-label="Этапы восстановления пароля">
          {steps.map((value, index) => <span key={value} className={`h-1.5 rounded-full ${value === step ? "bg-sky-500" : index < steps.indexOf(step) ? "bg-sky-200" : "bg-slate-100"}`} />)}
        </div>

        {step === "request" ? (
          <form onSubmit={requestResetCode} className="mt-6 space-y-4">
            <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Способ восстановления пароля">
              <button type="button" role="tab" aria-selected={method === "email"} onClick={() => setMethod("email")} className={`rounded-lg py-2 text-sm font-bold transition-colors ${method === "email" ? "bg-white text-sky-600 shadow-sm" : "text-slate-500"}`}>По Email</button>
              <button type="button" role="tab" aria-selected={method === "phone"} onClick={() => setMethod("phone")} className={`rounded-lg py-2 text-sm font-bold transition-colors ${method === "phone" ? "bg-white text-sky-600 shadow-sm" : "text-slate-500"}`}>По номеру</button>
            </div>

            {method === "email" ? (
              <label className="block text-sm font-bold text-slate-700">Email<span className="mt-1 flex items-center gap-2 rounded-xl border border-slate-200 px-3"><Mail className="h-4 w-4 text-slate-400" /><input autoFocus required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full py-3 outline-none" placeholder="name@example.com" /></span></label>
            ) : (
              <label className="block text-sm font-bold text-slate-700">Номер телефона<span className="mt-1 flex items-center gap-2 rounded-xl border border-slate-200 px-3"><Phone className="h-4 w-4 text-slate-400" /><input autoFocus required type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(formatPhoneNumber(event.target.value))} className="w-full py-3 outline-none" placeholder="+7 (___) ___-__-__" /></span></label>
            )}

            <button disabled={isSubmitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 py-3 font-bold text-white hover:bg-sky-600 disabled:opacity-50">{isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : method === "email" ? <Mail className="h-4 w-4" /> : <Phone className="h-4 w-4" />}Получить код</button>
          </form>
        ) : null}

        {step === "otp" ? (
          <form onSubmit={verifyCode} className="mt-6 space-y-4">
            <label className="block text-sm font-bold text-slate-700">{method === "email" ? "Код из письма" : "Код из SMS"}<span className="mt-1 flex items-center gap-2 rounded-xl border border-slate-200 px-3"><ShieldCheck className="h-4 w-4 text-slate-400" /><input autoFocus required inputMode="numeric" maxLength={4} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} className="w-full py-3 tracking-[0.3em] outline-none" placeholder="0000" /></span></label>
            {resendSeconds > 0 ? (
              <p className="text-center text-sm text-slate-400">Отправить код повторно через {resendSeconds} сек</p>
            ) : (
              <button type="button" onClick={resendResetCode} disabled={isSubmitting} className="mx-auto block text-sm font-medium text-sky-600 transition-colors hover:text-sky-700 disabled:cursor-not-allowed disabled:text-slate-400">Отправить код повторно</button>
            )}
            <div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => setStep("request")} className="flex items-center justify-center gap-2 rounded-xl bg-slate-100 py-3 font-bold text-slate-700"><ArrowLeft className="h-4 w-4" />Назад</button><button disabled={isSubmitting} className="flex items-center justify-center gap-2 rounded-xl bg-sky-500 py-3 font-bold text-white hover:bg-sky-600 disabled:opacity-50">{isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Проверить"}</button></div>
          </form>
        ) : null}

        {step === "password" ? (
          <form onSubmit={completeReset} className="mt-6 space-y-4">
            <label className="block text-sm font-bold text-slate-700">Новый пароль<span className="mt-1 flex items-center gap-2 rounded-xl border border-slate-200 px-3"><LockKeyhole className="h-4 w-4 text-slate-400" /><input autoFocus required minLength={8} type={showPassword ? "text" : "password"} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="w-full py-3 outline-none" placeholder="Не менее 8 символов" /><button type="button" onClick={() => setShowPassword((visible) => !visible)} className="shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600" aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span></label>
            <label className="block text-sm font-bold text-slate-700">Повторите пароль<span className="mt-1 flex items-center gap-2 rounded-xl border border-slate-200 px-3"><LockKeyhole className="h-4 w-4 text-slate-400" /><input required minLength={8} type={showRepeatPassword ? "text" : "password"} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} className="w-full py-3 outline-none" /><button type="button" onClick={() => setShowRepeatPassword((visible) => !visible)} className="shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600" aria-label={showRepeatPassword ? "Скрыть пароль" : "Показать пароль"}>{showRepeatPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span></label>
            <div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => setStep("otp")} className="flex items-center justify-center gap-2 rounded-xl bg-slate-100 py-3 font-bold text-slate-700"><ArrowLeft className="h-4 w-4" />Назад</button><button disabled={isSubmitting} className="flex items-center justify-center gap-2 rounded-xl bg-sky-500 py-3 font-bold text-white hover:bg-sky-600 disabled:opacity-50">{isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Сохранить пароль"}</button></div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
