import React, { useState, useEffect } from "react";
import { X, Share, PlusSquare } from "lucide-react";

export default function InstallPWA() {
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    // Detect iOS
    const isIos = () => {
      const userAgent = window.navigator.userAgent.toLowerCase();
      return /iphone|ipad|ipod/.test(userAgent);
    };

    // Detect if already in standalone mode
    const isInStandaloneMode = () => {
      return (
        "standalone" in window.navigator &&
        (window.navigator as any).standalone
      );
    };

    if (isIos() && !isInStandaloneMode()) {
      setShowPrompt(true);
    }
  }, []);

  if (!showPrompt) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 pb-8 bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.1)] rounded-t-3xl border-t border-slate-100 transform transition-transform">
      <div className="flex flex-col gap-4">
        <div className="flex justify-between items-start">
          <div className="flex flex-col">
            <h3 className="font-bold text-slate-800 text-lg tracking-tight">Установить Дармавоз</h3>
            <p className="text-sm font-medium text-slate-500">Добавьте приложение на экран Домой для быстрой работы</p>
          </div>
          <button 
            onClick={() => setShowPrompt(false)}
            className="p-2 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-400 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl flex flex-col gap-3">
          <p className="text-sm font-medium text-slate-600 flex items-center gap-2">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-200 text-slate-700 text-xs font-bold">1</span>
            Нажмите кнопку <Share className="w-4 h-4 text-[#2DB0E6]" /> в меню Safari
          </p>
          <div className="w-full h-px bg-slate-200/50" />
          <p className="text-sm font-medium text-slate-600 flex items-center gap-2">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-200 text-slate-700 text-xs font-bold">2</span>
            Выберите <span className="font-bold">На экран «Домой»</span> <PlusSquare className="w-4 h-4" />
          </p>
        </div>
      </div>
    </div>
  );
}
