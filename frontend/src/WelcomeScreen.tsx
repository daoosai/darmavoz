import React, { useState } from "react";
import PrivacyPolicyModal from "./PrivacyPolicyModal";

function RequisitesModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/45 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="requisites-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="requisites-title" className="text-xl font-black text-slate-900">
          Реквизиты
        </h2>

        <div className="mt-6 space-y-2 text-sm leading-relaxed text-slate-600">
          <p>© 2026 Дармавоз</p>
          <p>ИП Масловский Сергей Николаевич</p>
          <p>ИНН 720414310753</p>
          <p>ОГРНИП 324723200032630</p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full rounded-2xl bg-[#2DB0E6] py-3.5 font-bold text-white transition-colors hover:bg-[#209ccf]"
        >
          Закрыть
        </button>
      </div>
    </div>
  );
}

export default function WelcomeScreen({
  onSelectClient,
  onSelectEmployee,
}: {
  onSelectClient: () => void;
  onSelectEmployee: () => void;
}) {
  const [isPrivacyPolicyOpen, setIsPrivacyPolicyOpen] = useState(false);
  const [isRequisitesOpen, setIsRequisitesOpen] = useState(false);

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

      <footer className="mb-4 mt-4 flex justify-center gap-2 text-xs text-gray-400">
        <button
          type="button"
          onClick={() => setIsRequisitesOpen(true)}
          className="transition-colors hover:text-gray-600"
        >
          Реквизиты
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          onClick={() => setIsPrivacyPolicyOpen(true)}
          className="transition-colors hover:text-gray-600"
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
