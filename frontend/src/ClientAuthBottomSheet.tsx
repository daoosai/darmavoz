import React, { useState, useEffect, useRef } from "react";
import { X, ChevronLeft, Loader2 } from "lucide-react";
import { baseURL } from "./utils";
import toast from "react-hot-toast";
import { AnimatePresence, motion } from "motion/react";
import { switchAuthenticatedSession } from "./pushAuth";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function ClientAuthBottomSheet({ isOpen, onClose }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorText, setErrorText] = useState("");

  const [phone, setPhone] = useState("+7");
  const [agree3, setAgree3] = useState(false);
  const [agree4, setAgree4] = useState(false);

  const [timer, setTimer] = useState(40);

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

  const cleanPhoneNumber = (p: string) => {
    return p.replace(/[\s()+-]/g, '');
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(formatPhoneNumber(e.target.value));
  };

  const [code, setCode] = useState(["", "", "", ""]);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);
  
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setPhone("+7");
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
        setTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [step, timer]);

  const handleSendCode = async () => {
    const digitsOnly = phone.replace(/\D/g, "");
    if (digitsOnly.length < 11) {
      setErrorText("Введите корректный номер телефона");
      return;
    }
    if (!agree4) {
      setErrorText("Необходимо согласие с политикой конфиденциальности");
      return;
    }
    
    setErrorText("");
    setIsSubmitting(true);
    const cleanPhone = cleanPhoneNumber(phone);
    try {
      const res = await fetch(`${baseURL}/auth/client/send-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: cleanPhone }),
      });
      if (res.ok) {
        setStep(2);
        setTimer(40);
      } else {
        const errorData = await res.json().catch(() => ({}));
        const errorMsg = errorData.detail || "Ошибка отправки кода";
        setErrorText(errorMsg);
      }
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || "Сетевая ошибка";
      setErrorText(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerify = async (fullCode: string) => {
    setErrorText("");
    setIsSubmitting(true);
    const cleanPhone = cleanPhoneNumber(phone);
    try {
      const res = await fetch(`${baseURL}/auth/client/verify-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: cleanPhone, code: fullCode }),
      });
      if (res.ok) {
        const data = await res.json();
        await switchAuthenticatedSession({
          token: data.access_token,
          role: "client",
        });
        toast.success("Вход выполнен");
        onClose();
        // Since we emit CustomEvent inside login, or we can just fetch Profile here
        // usually it's handled globally by useAuthStore -> fetch profile
      } else {
        const errorData = await res.json().catch(() => ({}));
        const errorMsg = errorData.detail || "Неверный код";
        setErrorText(errorMsg);
      }
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || "Сетевая ошибка";
      setErrorText(errorMsg);
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
            onClick={() => {
              setStep(1);
              setCode(["", "", "", ""]);
            }}
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
                Введите свой номер телефона, чтобы войти в приложение
              </p>

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

              {errorText && <div className="text-red-500 text-sm font-semibold mb-4">{errorText}</div>}

              <button
                disabled={isSubmitting || !agree4}
                onClick={handleSendCode}
                className="w-full bg-[#2DB0E6] text-white py-4 rounded-2xl font-bold text-lg active:scale-[0.98] transition-transform disabled:opacity-50 flex items-center justify-center gap-2 mt-auto"
              >
                {isSubmitting && <Loader2 className="w-5 h-5 animate-spin" />}
                Далее
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col animate-in fade-in slide-in-from-right-4 duration-300 h-full">
              <h2 className="text-2xl font-bold text-slate-800 mb-2 mt-4 text-center leading-tight">
                Введите код
              </h2>
              <p className="text-[15px] text-slate-600 mb-8 font-medium text-center px-4">
                Мы отправили код на номер<br/>
                <span className="text-slate-900 font-bold">{phone}</span>
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
              
              <div className="text-center font-medium mb-8 text-sm">
                {timer > 0 ? (
                  <span className="text-slate-400">
                    Получить новый код через {timer} сек.
                  </span>
                ) : (
                  <button
                    onClick={handleSendCode}
                    className="text-[#2DB0E6] active:opacity-80 transition-opacity"
                  >
                    Получить новый код
                  </button>
                )}
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

