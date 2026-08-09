import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Loader2, LockKeyhole, Mail, ShieldCheck, X } from "lucide-react";
import toast from "react-hot-toast";

import { baseURL, extractApiErrorMessage } from "./utils";

type ResetStep = "email" | "otp" | "password";

export default function PasswordResetModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<ResetStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);

  const sendResetCode = async (targetEmail: string) => {
    const normalizedEmail = targetEmail.trim().toLowerCase();
    setIsSubmitting(true);
    try {
      const response = await fetch(`${baseURL}/auth/password-reset/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data, "Не удалось отправить код"));
      }
      setEmail(normalizedEmail);
      setCode("");
      setResendSeconds(30);
      toast.success("Код отправлен на email");
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
    if (!email.trim()) {
      toast.error("Введите email");
      return;
    }

    if (await sendResetCode(email)) {
      setStep("otp");
    }
  };

  const resendResetCode = async () => {
    if (resendSeconds > 0 || isSubmitting) {
      return;
    }

    await sendResetCode(email);
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
      toast.error("Введите код из письма");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${baseURL}/auth/password-reset/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: code.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.reset_token) {
        throw new Error(extractApiErrorMessage(data, "Неверный или истёкший код"));
      }
      setResetToken(data.reset_token);
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
      const response = await fetch(`${baseURL}/auth/password-reset/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset_token: resetToken, new_password: newPassword }),
      });
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

  const stepMeta: Record<ResetStep, { title: string; description: string }> = {
    email: { title: "Восстановление пароля", description: "Укажите email учётной записи администратора или логиста." },
    otp: { title: "Введите код", description: `Мы отправили код на ${email}.` },
    password: { title: "Новый пароль", description: "Придумайте новый пароль для входа." },
  };
  const currentMeta = stepMeta[step];

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="password-reset-title">
      <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="password-reset-title" className="text-xl font-black text-slate-900">{currentMeta.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{currentMeta.description}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100" aria-label="Закрыть"><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2" aria-label="Этапы восстановления пароля">
          {(["email", "otp", "password"] as ResetStep[]).map((value, index) => <span key={value} className={`h-1.5 rounded-full ${value === step ? "bg-sky-500" : index < ["email", "otp", "password"].indexOf(step) ? "bg-sky-200" : "bg-slate-100"}`} />)}
        </div>

        {step === "email" ? (
          <form onSubmit={requestResetCode} className="mt-6 space-y-4">
            <label className="block text-sm font-bold text-slate-700">Email<span className="mt-1 flex items-center gap-2 rounded-xl border border-slate-200 px-3"><Mail className="h-4 w-4 text-slate-400" /><input autoFocus required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full py-3 outline-none" placeholder="name@example.com" /></span></label>
            <button disabled={isSubmitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 py-3 font-bold text-white hover:bg-sky-600 disabled:opacity-50">{isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}Получить код</button>
          </form>
        ) : null}

        {step === "otp" ? (
          <form onSubmit={verifyCode} className="mt-6 space-y-4">
            <label className="block text-sm font-bold text-slate-700">Код из письма<span className="mt-1 flex items-center gap-2 rounded-xl border border-slate-200 px-3"><ShieldCheck className="h-4 w-4 text-slate-400" /><input autoFocus required inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value)} className="w-full py-3 tracking-[0.3em] outline-none" placeholder="000000" /></span></label>
            {resendSeconds > 0 ? (
              <p className="text-center text-sm text-slate-400">Отправить код повторно через {resendSeconds} сек</p>
            ) : (
              <button type="button" onClick={resendResetCode} disabled={isSubmitting} className="mx-auto block text-sm font-medium text-sky-600 transition-colors hover:text-sky-700 disabled:cursor-not-allowed disabled:text-slate-400">Отправить код повторно</button>
            )}
            <div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => setStep("email")} className="flex items-center justify-center gap-2 rounded-xl bg-slate-100 py-3 font-bold text-slate-700"><ArrowLeft className="h-4 w-4" />Назад</button><button disabled={isSubmitting} className="flex items-center justify-center gap-2 rounded-xl bg-sky-500 py-3 font-bold text-white hover:bg-sky-600 disabled:opacity-50">{isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Проверить"}</button></div>
          </form>
        ) : null}

        {step === "password" ? (
          <form onSubmit={completeReset} className="mt-6 space-y-4">
            <label className="block text-sm font-bold text-slate-700">Новый пароль<span className="mt-1 flex items-center gap-2 rounded-xl border border-slate-200 px-3"><LockKeyhole className="h-4 w-4 text-slate-400" /><input autoFocus required minLength={8} type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="w-full py-3 outline-none" placeholder="Не менее 8 символов" /></span></label>
            <label className="block text-sm font-bold text-slate-700">Повторите пароль<input required minLength={8} type="password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 outline-none" /></label>
            <div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => setStep("otp")} className="flex items-center justify-center gap-2 rounded-xl bg-slate-100 py-3 font-bold text-slate-700"><ArrowLeft className="h-4 w-4" />Назад</button><button disabled={isSubmitting} className="flex items-center justify-center gap-2 rounded-xl bg-sky-500 py-3 font-bold text-white hover:bg-sky-600 disabled:opacity-50">{isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Сохранить пароль"}</button></div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
