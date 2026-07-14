import React, { useState } from "react";

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

  const handleDriverClick = () => {
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2000);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6 text-center relative overflow-hidden">
      {/* Toast Notification */}
      {showToast && (
        <div className="absolute top-10 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-6 py-3 rounded-full text-sm font-medium shadow-xl z-50 animate-in fade-in slide-in-from-top-4">
          Приложение водителя в разработке
        </div>
      )}

      <h1 className="text-4xl font-black text-[#2DB0E6] mb-16 tracking-tight">
        Дармавоз
      </h1>

      <div className="flex flex-col gap-4 w-full max-w-xs">
        <button
          onClick={onSelectClient}
          className="w-full bg-white text-[#2DB0E6] border border-slate-200 py-4 rounded-2xl font-bold text-lg shadow-sm active:bg-slate-50 transition-colors"
        >
          Я Клиент
        </button>

        <button
          onClick={onSelectEmployee}
          className="w-full bg-white text-[#2DB0E6] border-2 border-[#2DB0E6] py-4 rounded-2xl font-bold text-lg shadow-sm active:bg-blue-50 transition-colors"
        >
          Вход для сотрудников
        </button>

        <button
          onClick={onSelectDriverRegister}
          className="w-full bg-[#2DB0E6] text-white border-2 border-[#2DB0E6] py-4 rounded-2xl font-bold text-lg shadow-sm active:bg-blue-700 transition-colors mt-2"
        >
          Регистрация водителя
        </button>

      </div>
    </div>
  );
}
