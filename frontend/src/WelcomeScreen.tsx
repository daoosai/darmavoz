import React, { useState } from "react";
import PrivacyPolicyModal from "./PrivacyPolicyModal";
import RequisitesModal from "./RequisitesModal";

export default function WelcomeScreen({
  onSelectClient,
  onSelectEmployee,
  onSelectDriverRegister,
}: {
  onSelectClient: () => void;
  onSelectEmployee: () => void;
  onSelectDriverRegister: () => void;
}) {
  const [showToast, setShowToast] = useState(false);
  const [isRequisitesOpen, setIsRequisitesOpen] = useState(false);
  const [isPrivacyPolicyOpen, setIsPrivacyPolicyOpen] = useState(false);

  const handleDriverClick = () => {
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2000);
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center overflow-y-auto bg-slate-50 px-6 text-center">
      {/* Toast Notification */}
      {showToast && (
        <div className="absolute top-10 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-6 py-3 rounded-full text-sm font-medium shadow-xl z-50 animate-in fade-in slide-in-from-top-4">
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
            className="w-full rounded-2xl bg-white py-4 text-lg font-bold text-[#2DB0E6] shadow-sm transition-colors active:bg-slate-50"
          >
            Я Клиент
          </button>

          <button
            onClick={onSelectEmployee}
            className="w-full rounded-2xl bg-white py-4 text-lg font-bold text-[#2DB0E6] shadow-sm transition-colors active:bg-blue-50"
          >
            Вход для сотрудников
          </button>

          <button
            onClick={onSelectDriverRegister}
            className="mt-2 w-full rounded-2xl bg-[#2DB0E6] py-4 text-lg font-bold text-white shadow-sm transition-colors active:bg-blue-700"
          >
            Регистрация водителя
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

      <RequisitesModal
        isOpen={isRequisitesOpen}
        onClose={() => setIsRequisitesOpen(false)}
      />
      <PrivacyPolicyModal
        isOpen={isPrivacyPolicyOpen}
        onClose={() => setIsPrivacyPolicyOpen(false)}
      />
    </div>
  );
}
