import React, { useState, useEffect, useRef } from "react";
import { X, ChevronLeft, Loader2 } from "lucide-react";
import { baseURL } from "./utils";
import { useAuthStore } from "./store";
import toast from "react-hot-toast";
import { AnimatePresence, motion } from "motion/react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function ClientAuthBottomSheet({ isOpen, onClose }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorText, setErrorText] = useState("");

  const [email, setEmail] = useState("");
  const [agree1, setAgree1] = useState(false);
  const [agree2, setAgree2] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("+7");
  const [agree3, setAgree3] = useState(false);
  const [agree4, setAgree4] = useState(false);

  const formatPhoneNumber = (value: string) => {
    let digits = value.replace(/\D/g, "");
    if (digits.startsWith("7") || digits.startsWith("8")) {
      digits = digits.substring(1);
    }
    digits = digits.substring(0, 10);
    
    let formatted = "+7";
    if (digits.length > 0) {
      formatted += " (" + digits.substring(0, 3);
    }
    if (digits.length >= 3) {
      formatted += ") " + digits.substring(3, 6);
    }
    if (digits.length >= 6) {
      formatted += "-" + digits.substring(6, 8);
    }
    if (digits.length >= 8) {
      formatted += "-" + digits.substring(8, 10);
    }
    return formatted;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(formatPhoneNumber(e.target.value));
  };

  const [code, setCode] = useState(["", "", "", ""]);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);
  
  const { login } = useAuthStore();

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setEmail("");
      setName("");
      setPhone("+7");
      setCode(["", "", "", ""]);
      setErrorText("");
    } else {
      document.body.style.overflow = "";
    }
  }, [isOpen]);

  const handleSendCode = async () => {
    if (!email.includes("@")) {
      setErrorText("Введите корректный email");
      return;
    }
    if (!agree1 || !agree2) {
      setErrorText("Необходимо согласие со всеми условиями");
      return;
    }
    
    setErrorText("");
    setIsSubmitting(true);
    try {
      const res = await fetch(`${baseURL}/auth/client/send-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.is_new_user) {
          setStep(2);
        } else {
          setStep(3);
        }
      } else {
        setErrorText("Ошибка сервера");
      }
    } catch {
      setErrorText("Сетевая ошибка");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegister = async () => {
    const digitsOnly = phone.replace(/\D/g, "");
    if (!name.trim() || digitsOnly.length < 11) {
      setErrorText("Заполните все данные корректно");
      return;
    }
    if (!agree3 || !agree4) {
      setErrorText("Необходимо согласие со всеми условиями");
      return;
    }
    setErrorText("");
    setIsSubmitting(true);
    const cleanPhone = "+" + digitsOnly;
    try {
      const res = await fetch(`${baseURL}/auth/client/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, phone: cleanPhone }),
      });
      if (res.ok) {
        setStep(3);
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorText(data.detail || "Пользователь с таким телефонным номером уже зарегистрирован");
      }
    } catch {
      setErrorText("Сетевая ошибка");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerify = async (fullCode: string) => {
    setErrorText("");
    setIsSubmitting(true);
    try {
      const res = await fetch(`${baseURL}/auth/client/verify-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: fullCode }),
      });
      if (res.ok) {
        const data = await res.json();
        login(data.access_token, "client");
        toast.success("Вход выполнен");
        onClose();
      } else {
        setErrorText("Неверный код");
      }
    } catch {
      setErrorText("Сетевая ошибка");
    } finally {
      setIsSubmitting(false);
    }
  };

  const onCodeChange = (val: string, i: number) => {
    if (!/^\d*$/.test(val)) return;
    const newCode = [...code];
    newCode[i] = val.slice(-1);
    setCode(newCode);

    if (val && i < 3) {
      inputsRef.current[i + 1]?.focus();
    }
    
    if (newCode.every(c => c !== "")) {
      handleVerify(newCode.join(""));
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex flex-col justify-end">
          {/* Backdrop */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" 
            onClick={onClose}
          />
          
          {/* Sheet Content */}
          <motion.div 
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", bounce: 0, duration: 0.4 }}
            className="relative bg-white w-full max-w-md mx-auto rounded-t-3xl shadow-2xl flex flex-col mt-auto max-h-[85vh] overflow-hidden"
          >
        
        {/* Decorative Handle */}
        <div className="w-full flex justify-center pt-3 pb-1">
          <div className="w-12 h-1.5 bg-slate-200 rounded-full" />
        </div>
        
        {step === 2 && (
          <button 
            onClick={() => setStep(step - 1)}
            className="absolute left-4 top-4 p-2 text-slate-800"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        <div className="px-6 pb-6 pt-4 flex-1 overflow-y-auto">
          {step === 1 && (
            <div className="flex flex-col animate-in fade-in slide-in-from-right-4 duration-300">
              <h2 className="text-2xl font-bold text-slate-800 mb-2 mt-4 leading-tight">
                Вход / Регистрация
              </h2>
              <p className="text-[15px] text-slate-600 mb-8 font-medium">
                Введите свой адрес электронной почты, чтобы войти в приложение
              </p>

              <div className="relative mb-6">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full border border-[#2DB0E6] rounded-2xl p-4 text-lg font-medium text-slate-800 focus:outline-none"
                />
                <label className="absolute -top-2 left-4 bg-white px-1 text-xs font-semibold text-[#2DB0E6]">E-mail</label>
              </div>

              <div className="flex flex-col gap-4 mb-8">
                <div className="flex items-start gap-4 cursor-pointer" onClick={() => setAgree1(!agree1)}>
                  <div className={`w-6 h-6 rounded flex items-center justify-center mt-1 shrink-0 ${agree1 ? "bg-[#2DB0E6]" : "border border-slate-300"}`}>
                    {agree1 && <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                  </div>
                  <span className="text-[15px] text-slate-500 font-medium leading-snug">
                    Я согласен(-на) с политикой<br/><span className="border-b border-slate-400">конфиденциальности</span>
                  </span>
                </div>
                <div className="flex items-start gap-4 cursor-pointer" onClick={() => setAgree2(!agree2)}>
                  <div className={`w-6 h-6 rounded flex items-center justify-center mt-1 shrink-0 ${agree2 ? "bg-[#2DB0E6]" : "border border-slate-300"}`}>
                    {agree2 && <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                  </div>
                  <span className="text-[15px] text-slate-500 font-medium leading-snug">
                    Я даю согласие(-ие) на обработку<br/><span className="border-b border-slate-400">персональных данных</span>
                  </span>
                </div>
              </div>

              {errorText && <div className="text-red-500 text-sm font-semibold mb-4">{errorText}</div>}

              <button
                disabled={isSubmitting || !agree1 || !agree2}
                onClick={handleSendCode}
                className="w-full bg-[#2DB0E6] text-white py-4 rounded-2xl font-bold text-lg active:scale-[0.98] transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSubmitting && <Loader2 className="w-5 h-5 animate-spin" />}
                Далее
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col animate-in fade-in slide-in-from-right-4 duration-300">
              <h2 className="text-2xl font-bold text-slate-800 mb-8 mt-4 text-center leading-tight">
                Давайте познакомимся
              </h2>

              <div className="relative mb-6">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border border-[#2DB0E6] rounded-2xl p-4 text-lg font-medium text-slate-800 focus:outline-none"
                />
                <label className="absolute -top-2 left-4 bg-white px-1 text-xs font-semibold text-[#2DB0E6]">Укажите ваше ФИО *</label>
              </div>

              <div className="relative mb-6">
                <input
                  type="tel"
                  value={phone}
                  onChange={handlePhoneChange}
                  className="w-full border border-[#2DB0E6] rounded-2xl p-4 text-lg font-medium text-slate-800 focus:outline-none"
                />
                <label className="absolute -top-2 left-4 bg-white px-1 text-xs font-semibold text-[#2DB0E6]">Номер телефона *</label>
              </div>

              <div className="flex flex-col gap-4 mb-6">
                <div className="flex items-start gap-4 cursor-pointer" onClick={() => setAgree3(!agree3)}>
                  <div className={`w-6 h-6 rounded flex items-center justify-center mt-1 shrink-0 ${agree3 ? "bg-[#2DB0E6]" : "border border-slate-300"}`}>
                    {agree3 && <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                  </div>
                  <span className="text-[14px] text-slate-500 font-medium leading-snug">
                    Я согласен(-на) получать уведомления о статусах заказа, рекламных предложениях и новинках в пушах, смс и на почту
                  </span>
                </div>
                <div className="flex items-start gap-4 cursor-pointer" onClick={() => setAgree4(!agree4)}>
                  <div className={`w-6 h-6 rounded flex items-center justify-center mt-1 shrink-0 ${agree4 ? "bg-[#2DB0E6]" : "border border-slate-300"}`}>
                    {agree4 && <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                  </div>
                  <span className="text-[14px] text-slate-500 font-medium leading-snug">
                    Я даю согласие(-ие) на обработку<br/><span className="border-b border-slate-400">персональных данных</span>
                  </span>
                </div>
              </div>

              {errorText && (
                <div className="text-red-500 text-sm font-semibold mb-4 leading-tight">
                  {errorText}
                  {errorText.includes("телефонным") && (
                    <div className="mt-2 text-slate-800 font-medium">Хотите продолжить авторизацию с этим номером телефона?</div>
                  )}
                </div>
              )}

              <button
                disabled={isSubmitting || !agree4}
                onClick={handleRegister}
                className="w-full bg-[#2DB0E6] text-white py-4 rounded-2xl font-bold text-lg active:scale-[0.98] transition-transform disabled:opacity-50 flex items-center justify-center gap-2 mt-auto"
              >
                {isSubmitting && <Loader2 className="w-5 h-5 animate-spin" />}
                {errorText.includes("телефонным") ? "Да, хочу" : "Далее"}
              </button>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col animate-in fade-in slide-in-from-right-4 duration-300 h-full">
              <h2 className="text-2xl font-bold text-slate-800 mb-2 mt-4 text-center leading-tight">
                Вход / Регистрация
              </h2>
              <p className="text-[15px] text-slate-600 mb-8 font-medium text-center px-4">
                Мы отправили код на почту<br/>
                <span className="text-slate-900 font-bold">{email}</span>. Введите его, чтобы войти
              </p>

              <div className="flex justify-center gap-3 mb-6">
                {code.map((val, i) => (
                  <input
                    key={i}
                    ref={el => inputsRef.current[i] = el}
                    type="number"
                    maxLength={1}
                    value={val}
                    onChange={(e) => onCodeChange(e.target.value, i)}
                    onKeyDown={(e) => {
                      if (e.key === "Backspace" && !val && i > 0) {
                        inputsRef.current[i - 1]?.focus();
                      }
                    }}
                    className="w-14 h-16 border-2 border-slate-200 rounded-2xl text-center text-3xl font-black text-slate-800 focus:border-[#2DB0E6] focus:outline-none transition-colors"
                  />
                ))}
              </div>
              
              <div className="text-center text-slate-400 font-medium mb-8 text-sm">
                Отправить повторно через 56 сек
              </div>

              {errorText && <div className="text-red-500 text-sm font-semibold mb-4 text-center">{errorText}</div>}

              <button
                disabled={isSubmitting || code.some(c => !c)}
                onClick={() => handleVerify(code.join(""))}
                className="w-full mt-auto bg-[#2DB0E6] text-white py-4 rounded-2xl font-bold text-lg active:scale-[0.98] transition-transform disabled:bg-slate-200 disabled:text-white flex items-center justify-center gap-2"
              >
                {isSubmitting && <Loader2 className="w-5 h-5 animate-spin" />}
                Подтвердить
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
      )}
    </AnimatePresence>
  );
}
