import React, { useState } from "react";
import PrivacyPolicyModal from "./PrivacyPolicyModal";
import RequisitesModal from "./RequisitesModal";

export default function WelcomeScreen({
  onSelectClient,
  onSelectEmployee,
}: {
  onSelectClient: () => void;
  onSelectEmployee: () => void;
}) {
  const [isRequisitesOpen, setIsRequisitesOpen] = useState(false);
  const [isPrivacyPolicyOpen, setIsPrivacyPolicyOpen] = useState(false);

  return (
    <div className="relative flex min-h-screen flex-col items-center overflow-y-auto bg-slate-50 px-6 text-center">
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
            Вход для партнеров
          </button>
        </div>
      </div>

      <footer className="mb-4 mt-6 flex flex-col space-y-2 text-center text-xs text-gray-400">
        <p className="text-sm text-gray-500">
          Служба поддержки{" "}
          <a href="tel:+73452900900" className="font-bold text-gray-700">
            8 (3452) 900 900
          </a>
        </p>
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
