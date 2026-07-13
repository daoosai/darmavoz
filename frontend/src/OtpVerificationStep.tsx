import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";

interface OtpVerificationStepProps {
  errorText: string;
  isSubmitting: boolean;
  phone: string;
  title: string;
  onBack: () => void;
  onResend: () => Promise<void> | void;
  onVerify: (code: string) => Promise<void> | void;
  resendLabel?: string;
  submitLabel?: string;
}

export default function OtpVerificationStep({
  errorText,
  isSubmitting,
  phone,
  title,
  onBack,
  onResend,
  onVerify,
  resendLabel = "Получить новый код",
  submitLabel = "Подтвердить",
}: OtpVerificationStepProps) {
  const [code, setCode] = useState(["", "", "", ""]);
  const [timer, setTimer] = useState(40);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    setCode(["", "", "", ""]);
    setTimer(40);
  }, [phone, title]);

  useEffect(() => {
    if (timer <= 0) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setTimer((prev) => prev - 1);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [timer]);

  const handleCodeChange = (value: string, index: number) => {
    if (!/^\d*$/.test(value)) {
      return;
    }

    const nextCode = [...code];
    nextCode[index] = value.slice(-1);
    setCode(nextCode);

    if (value && index < nextCode.length - 1) {
      inputsRef.current[index + 1]?.focus();
    }

    if (nextCode.every((digit) => digit !== "")) {
      void onVerify(nextCode.join(""));
    }
  };

  const handleResend = async () => {
    setCode(["", "", "", ""]);
    setTimer(40);
    await onResend();
  };

  return (
    <div className="w-full max-w-sm flex flex-col gap-6">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 self-start rounded-full px-3 py-2 text-slate-600 hover:bg-slate-50 transition-colors"
      >
        <ChevronLeft className="w-5 h-5" />
        Назад
      </button>

      <div className="text-center">
        <h2 className="text-2xl font-bold text-slate-800 mb-2">{title}</h2>
        <p className="text-[15px] text-slate-600 font-medium">
          Мы отправили код на номер
          <br />
          <span className="text-slate-900 font-bold">{phone}</span>
        </p>
      </div>

      <div className="flex justify-center gap-3">
        {code.map((value, index) => (
          <input
            key={index}
            ref={(element) => {
              inputsRef.current[index] = element;
            }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={value}
            onChange={(event) => handleCodeChange(event.target.value, index)}
            onKeyDown={(event) => {
              if (event.key === "Backspace" && !value && index > 0) {
                inputsRef.current[index - 1]?.focus();
              }
            }}
            className="w-14 h-16 border-2 border-slate-200 rounded-2xl text-center text-3xl font-black text-slate-800 focus:border-[#2DB0E6] focus:outline-none transition-colors"
          />
        ))}
      </div>

      <div className="text-center font-medium text-sm min-h-5">
        {timer > 0 ? (
          <span className="text-slate-400">Получить новый код через {timer} сек.</span>
        ) : (
          <button
            type="button"
            onClick={() => void handleResend()}
            className="text-[#2DB0E6] active:opacity-80 transition-opacity"
          >
            {resendLabel}
          </button>
        )}
      </div>

      {errorText ? <div className="text-red-500 text-sm font-semibold text-center">{errorText}</div> : null}

      <button
        type="button"
        disabled={isSubmitting || code.some((digit) => !digit)}
        onClick={() => void onVerify(code.join(""))}
        className="w-full bg-[#2DB0E6] text-white py-4 rounded-2xl font-bold text-lg active:scale-[0.98] transition-transform disabled:bg-slate-200 disabled:text-white flex items-center justify-center gap-2"
      >
        {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
        {submitLabel}
      </button>
    </div>
  );
}
