import React from 'react';
import { User, MessageSquare, Share2, Info, ChevronRight } from 'lucide-react';

export default function ProfileScreen() {
  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 pb-24">
      {/* Auth Card */}
      <div className="bg-[#2DB0E6] rounded-[24px] p-5 flex items-center gap-4 text-white mb-6 shadow-md shadow-blue-500/20 active:opacity-90 cursor-pointer transition-opacity">
        <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center shrink-0">
          <User className="w-7 h-7 text-white" />
        </div>
        <div className="flex flex-col">
          <span className="font-bold text-lg">Вход / Регистрация</span>
        </div>
      </div>

      {/* Menu List */}
      <div className="bg-white rounded-[24px] flex flex-col overflow-hidden border border-slate-100 shadow-sm mb-auto">
        <MenuButton icon={MessageSquare} label="Обратная связь" />
        <div className="h-[1px] bg-slate-50 ml-[52px]"></div>
        <MenuButton icon={Share2} label="Поделиться приложением" />
        <div className="h-[1px] bg-slate-50 ml-[52px]"></div>
        <MenuButton icon={Info} label="О компании" />
      </div>

      {/* Version */}
      <div className="flex justify-center mt-8">
        <span className="text-sm text-slate-400 font-medium font-mono">Версия 1.0.1</span>
      </div>
    </div>
  );
}

function MenuButton({ icon: Icon, label }: { icon: any, label: string }) {
  return (
    <button className="flex items-center gap-3 p-4 bg-white active:bg-slate-50 transition-colors w-full text-left">
      <div className="w-7 h-7 flex items-center justify-center">
        <Icon className="w-5 h-5 text-[#2DB0E6]" />
      </div>
      <span className="flex-1 font-medium text-slate-700">{label}</span>
      <ChevronRight className="w-5 h-5 text-slate-400" />
    </button>
  );
}
