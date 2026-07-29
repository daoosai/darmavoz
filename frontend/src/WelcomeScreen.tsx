import React, { useState } from "react";
import PrivacyPolicyModal from "./PrivacyPolicyModal";
import RequisitesModal from "./RequisitesModal";

export default function WelcomeScreen({
  onSelectClient,
  onSelectEmployee,
  onSelectDriverRegister,
  onSelectSupplier,
}: {
  onSelectClient: () => void;
  onSelectEmployee: () => void;
  onSelectDriverRegister: () => void;
  onSelectSupplier: () => void;
}) {
  const [showToast, setShowToast] = useState(false);
  const [isRequisitesOpen, setIsRequisitesOpen] = useState(false);
  const [isPrivacyPolicyOpen, setIsPrivacyPolicyOpen] = useState(false);

  const handleDriverClick = () => {
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2000);
    onSelectDriverRegister();
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center overflow-y-auto bg-slate-50 px-6 text-center">
      {showToast && (
        <div className="absolute left-1/2 top-10 z-50 -translate-x-1/2 rounded-full bg-slate-900 px-6 py-3 text-sm font-medium text-white shadow-xl animate-in fade-in slide-in-from-top-4">
          Приложение водителя в разработке
        </div>
      )}

      <div className="flex w-full flex-1 flex-col items-center justify-center py-8">
        <h1 className="mb-16 text-4xl font-black tracking-tight text-[#2DB0E6]">
          Дармавоз
        </h1>

        <div className="flex w-full max-w-xs flex-col gap-4">
          <button
            onClick={onSelectClient}
            className="w-full rounded-2xl border border-slate-200 bg-white py-4 text-lg font-bold text-[#2DB0E6] shadow-sm transition-colors active:bg-slate-50"
          >
            Я Клиент
          </button>

          <button
            onClick={onSelectEmployee}
            className="w-full rounded-2xl border border-slate-200 bg-white py-4 text-lg font-bold text-[#2DB0E6] shadow-sm transition-colors active:bg-blue-50"
          >
            Вход для партнёров
          </button>

          <button
            onClick={handleDriverClick}
            className="mt-2 w-full rounded-2xl bg-[#2DB0E6] py-4 text-lg font-bold text-white shadow-sm transition-colors active:bg-blue-700"
          >
            Регистрация водителя
          </button>

          <button
            type="button"
            onClick={onSelectSupplier}
            className="mt-4 cursor-pointer text-center text-sm font-medium text-[#2DB0E6]"
          >
            Регистрация/вход для партнеров
          </button>
        </div>
      </div>

      <footer className="mb-4 mt-6 flex flex-col space-y-2 text-center text-xs text-gray-400">
        <button
          type="button"
          onClick={() => setIsRequisitesOpen(true)}
          className="underline-offset-4 transition-colors hover:text-gray-600 hover:underline"
        >
          Реквизиты сервиса
        </button>
        <button
          type="button"
          onClick={() => setIsPrivacyPolicyOpen(true)}
          className="underline-offset-4 transition-colors hover:text-gray-600 hover:underline"
        >
          Политика конфиденциальности
        </button>
      </footer>

      <RequisitesModal isOpen={isRequisitesOpen} onClose={() => setIsRequisitesOpen(false)} />
      <PrivacyPolicyModal
        isOpen={isPrivacyPolicyOpen}
        onClose={() => setIsPrivacyPolicyOpen(false)}
      />
    </div>
  );
}
