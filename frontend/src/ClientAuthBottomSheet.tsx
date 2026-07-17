import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { AnimatePresence, motion } from "motion/react";

import { switchAuthenticatedSession } from "./pushAuth";
import { baseURL, extractApiErrorMessage } from "./utils";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated?: () => void;
}

const normalizeEmailValue = (value: string) => value.trim().toLowerCase();
const isValidEmail = (value: string) => /\S+@\S+\.\S+/.test(normalizeEmailValue(value));

export default function ClientAuthBottomSheet({ isOpen, onClose, onAuthenticated }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [authMode, setAuthMode] = useState<"phone" | "email">("phone");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorText, setErrorText] = useState("");

  const [phone, setPhone] = useState("+7");
  const [email, setEmail] = useState("");
  const [agree3, setAgree3] = useState(false);
  const [agree4, setAgree4] = useState(false);

  const [timer, setTimer] = useState(40);
  const [code, setCode] = useState(["", "", "", ""]);
  const phoneInputRef = useRef<HTMLInputElement | null>(null);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const normalizePhoneDigits = (value: string) => {
    let digits = value.replace(/\D/g, "");
    if (digits.startsWith("7") || digits.startsWith("8")) {
      digits = digits.substring(1);
    }
    return digits.substring(0, 10);
  };

  const formatPhoneNumber = (value: string) => {
    const digits = normalizePhoneDigits(value);
    let formatted = "+7";
    if (digits.length > 0) {
      formatted += " (" + digits.substring(0, 3);
    }
    if (digits.length >= 4) {
      formatted += ") " + digits.substring(3, 6);
    }
    if (digits.length >= 7) {
      formatted += "-" + digits.substring(6, 8);
    }
    if (digits.length >= 9) {
      formatted += "-" + digits.substring(8, 10);
    }
    return formatted;
  };

  const cleanPhoneNumber = (value: string) => `7${normalizePhoneDigits(value)}`;

  const getCaretPositionByDigits = (digitsCount: number) => {
    const safeCount = Math.max(0, Math.min(10, digitsCount));
    return formatPhoneNumber(`7${"0".repeat(safeCount)}`).length;
  };

  const applyPhoneValue = (rawValue: string, digitsBeforeCaret: number) => {
    const formattedValue = formatPhoneNumber(rawValue);
    setPhone(formattedValue);
    requestAnimationFrame(() => {
      const input = phoneInputRef.current;
      if (!input) return;
      const caretPosition = getCaretPositionByDigits(digitsBeforeCaret);
      input.setSelectionRange(caretPosition, caretPosition);
    });
  };

  const handlePhoneChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const caretPosition = event.target.selectionStart ?? event.target.value.length;
    const digitsBeforeCaret = normalizePhoneDigits(
      event.target.value.slice(0, caretPosition),
    ).length;
    applyPhoneValue(event.target.value, digitsBeforeCaret);
  };

  const handlePhoneKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Backspace") return;
    const input = phoneInputRef.current;
    if (!input) return;

    const selectionStart = input.selectionStart ?? 0;
    const selectionEnd = input.selectionEnd ?? selectionStart;
    if (selectionStart !== selectionEnd) return;

    if (selectionStart <= 2) {
      event.preventDefault();
      applyPhoneValue("", 0);
      return;
    }

    const previousChar = input.value[selectionStart - 1];
    if (/\d/.test(previousChar)) return;

    event.preventDefault();
    const digits = normalizePhoneDigits(input.value);
    const digitsBeforeCaret = normalizePhoneDigits(input.value.slice(0, selectionStart)).length;
    const removeIndex = Math.max(0, digitsBeforeCaret - 1);
    const nextDigits = `${digits.slice(0, removeIndex)}${digits.slice(digitsBeforeCaret)}`;
    applyPhoneValue(nextDigits, removeIndex);
  };

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setAuthMode("phone");
      setPhone("+7");
      setEmail("");
      setCode(["", "", "", ""]);
      setErrorText("");
      setAgree3(false);
      setAgree4(false);
      setTimer(40);
    } else {
      document.body.style.overflow = "";
    }
  }, [isOpen]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (step === 2 && timer > 0) {
      interval = setInterval(() => {
        setTimer((previous) => previous - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [step, timer]);

  const sendCode = async () => {
    const endpoint = authMode === "phone" ? `${baseURL}/auth/client/send-code` : `${baseURL}/auth/email/send-code`;
    const body =
      authMode === "phone"
        ? { phone: cleanPhoneNumber(phone) }
        : { email: normalizeEmailValue(email), auth_scope: "client" };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(extractApiErrorMessage(data, "Ошибка отправки кода"));
    }

    return data;
  };

  const verifyCode = async (fullCode: string) => {
    const endpoint = authMode === "phone" ? `${baseURL}/auth/client/verify-code` : `${baseURL}/auth/email/verify`;
    const body =
      authMode === "phone"
        ? { phone: cleanPhoneNumber(phone), code: fullCode }
        : { email: normalizeEmailValue(email), code: fullCode, auth_scope: "client" };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(extractApiErrorMessage(data, "Неверный код"));
    }

    return data;
  };

  const handleSendCode = async () => {
    if (authMode === "phone") {
      const digitsOnly = phone.replace(/\D/g, "");
      if (digitsOnly.length < 11) {
        setErrorText("Введите корректный номер телефона");
        return;
      }
    } else if (!isValidEmail(email)) {
      setErrorText("Введите корректный email");
      return;
    }

    if (!agree4) {
      setErrorText("Необходимо согласие с политикой конфиденциальности");
      return;
    }

    setErrorText("");
    setIsSubmitting(true);
    try {
      await sendCode();
      setStep(2);
      setTimer(40);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Ошибка отправки кода");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerify = async (fullCode: string) => {
    setErrorText("");
    setIsSubmitting(true);
    try {
      const data = await verifyCode(fullCode);
      await switchAuthenticatedSession(data.access_token, "client");
      toast.success("Вход выполнен");
      onAuthenticated?.();
      onClose();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Сетевая ошибка");
    } finally {
      setIsSubmitting(false);
    }
  };

  const onCodeChange = (value: string, index: number) => {
    if (!/^\d*$/.test(value)) return;
    const nextCode = [...code];
    nextCode[index] = value.slice(-1);
    setCode(nextCode);

    if (value && index < 3) {
      inputsRef.current[index + 1]?.focus();
    }

    if (nextCode.every((item) => item !== "")) {
      void handleVerify(nextCode.join(""));
    }
  };

  const contactLabel = authMode === "phone" ? phone : normalizeEmailValue(email);

  return (
    <AnimatePresence>
      {isOpen ? (
        <div className="fixed inset-0 z-[9999] flex items-end justify-center sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
            onClick={onClose}
          />

          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", bounce: 0, duration: 0.4 }}
            className="relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
          >
            <div className="flex w-full justify-center pt-3 pb-1">
              <div className="h-1.5 w-12 rounded-full bg-slate-200" />
            </div>

            {step === 2 ? (
              <button
                onClick={() => {
                  setStep(1);
                  setCode(["", "", "", ""]);
                }}
                className="absolute left-4 top-4 p-2 text-slate-800"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            ) : null}

            <div className="mx-auto flex-1 w-full max-w-md overflow-y-auto px-6 pt-4 pb-6">
              {step === 1 ? (
                <div className="flex w-full flex-col items-center animate-in fade-in slide-in-from-right-4 duration-300">
                  <h2 className="mt-4 mb-2 text-center text-2xl font-bold leading-tight text-slate-800">
                    Вход / Регистрация
                  </h2>
                  <p className="mb-8 max-w-sm text-center text-[15px] font-medium text-slate-600">
                    {authMode === "phone"
                      ? "Введите свой номер телефона, чтобы войти в приложение"
                      : "Введите электронную почту, чтобы получить код входа"}
                  </p>

                  {authMode === "phone" ? (
                    <div className="relative mb-6 w-full">
                      <input
                        ref={phoneInputRef}
                        type="tel"
                        value={phone}
                        onChange={handlePhoneChange}
                        onKeyDown={handlePhoneKeyDown}
                        inputMode="tel"
                        maxLength={18}
                        className="w-full rounded-2xl border border-[#2DB0E6] p-4 text-lg font-medium text-slate-800 focus:outline-none"
                      />
                      <label className="absolute -top-2 left-4 bg-white px-1 text-xs font-semibold text-[#2DB0E6]">
                        Номер телефона *
                      </label>
                    </div>
                  ) : (
                    <div className="relative mb-6 w-full">
                      <input
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="w-full rounded-2xl border border-[#2DB0E6] p-4 text-lg font-medium text-slate-800 focus:outline-none"
                        placeholder="name@example.com"
                      />
                      <label className="absolute -top-2 left-4 bg-white px-1 text-xs font-semibold text-[#2DB0E6]">
                        Электронная почта *
                      </label>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode((current) => (current === "phone" ? "email" : "phone"));
                      setErrorText("");
                    }}
                    className="mb-6 text-center text-sm font-semibold text-[#187fac] underline decoration-[#2DB0E6]/40 underline-offset-4"
                  >
                    {authMode === "phone" ? "Войти через электронную почту" : "Войти по номеру телефона"}
                  </button>

                  <div className="mb-6 flex w-full flex-col gap-4">
                    <div className="flex cursor-pointer items-start gap-4" onClick={() => setAgree3(!agree3)}>
                      <div className={`mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded ${agree3 ? "bg-[#2DB0E6]" : "border border-slate-300"}`}>
                        {agree3 ? (
                          <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : null}
                      </div>
                      <span className="text-[14px] font-medium leading-snug text-slate-500">
                        Я согласен(-на) получать уведомления о статусах заказа, рекламных предложениях и новинках в пушах, sms и на почту
                      </span>
                    </div>
                    <div className="flex cursor-pointer items-start gap-4" onClick={() => setAgree4(!agree4)}>
                      <div className={`mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded ${agree4 ? "bg-[#2DB0E6]" : "border border-slate-300"}`}>
                        {agree4 ? (
                          <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : null}
                      </div>
                      <span className="text-[14px] font-medium leading-snug text-slate-500">
                        Я даю согласие на обработку персональных данных
                      </span>
                    </div>
                  </div>

                  {errorText ? <div className="mb-4 w-full text-center text-sm font-semibold text-red-500">{errorText}</div> : null}

                  <button
                    disabled={isSubmitting || !agree4}
                    onClick={handleSendCode}
                    className="mt-auto flex w-full items-center justify-center gap-2 rounded-2xl bg-[#2DB0E6] py-4 text-lg font-bold text-white transition-transform active:scale-[0.98] disabled:opacity-50"
                  >
                    {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                    Получить код
                  </button>
                </div>
              ) : (
                <div className="flex h-full flex-col animate-in fade-in slide-in-from-right-4 duration-300">
                  <h2 className="mt-4 mb-2 text-center text-2xl font-bold leading-tight text-slate-800">
                    {authMode === "phone" ? "Введите код" : "Введите код из письма"}
                  </h2>
                  <p className="mb-8 px-4 text-center text-[15px] font-medium text-slate-600">
                    Мы отправили код на
                    <br />
                    <span className="font-bold text-slate-900">{contactLabel}</span>
                  </p>

                  <div className="mb-6 flex justify-center gap-3">
                    {code.map((value, index) => (
                      <input
                        key={index}
                        ref={(element) => {
                          inputsRef.current[index] = element;
                        }}
                        type="number"
                        maxLength={1}
                        value={value}
                        onChange={(event) => onCodeChange(event.target.value, index)}
                        onKeyDown={(event) => {
                          if (event.key === "Backspace" && !value && index > 0) {
                            inputsRef.current[index - 1]?.focus();
                          }
                        }}
                        className="h-16 w-14 rounded-2xl border-2 border-slate-200 text-center text-3xl font-black text-slate-800 transition-colors focus:border-[#2DB0E6] focus:outline-none"
                      />
                    ))}
                  </div>

                  <div className="mb-8 text-center text-sm font-medium">
                    {timer > 0 ? (
                      <span className="text-slate-400">Получить новый код через {timer} сек.</span>
                    ) : (
                      <button onClick={handleSendCode} className="text-[#2DB0E6] transition-opacity active:opacity-80">
                        Получить новый код
                      </button>
                    )}
                  </div>

                  {errorText ? <div className="mb-4 text-center text-sm font-semibold text-red-500">{errorText}</div> : null}

                  <button
                    disabled={isSubmitting || code.some((item) => !item)}
                    onClick={() => void handleVerify(code.join(""))}
                    className="mt-auto flex w-full items-center justify-center gap-2 rounded-2xl bg-[#2DB0E6] py-4 text-lg font-bold text-white transition-transform active:scale-[0.98] disabled:bg-slate-200"
                  >
                    {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                    Подтвердить
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
