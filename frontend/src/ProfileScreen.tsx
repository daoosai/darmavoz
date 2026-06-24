import React from 'react';
import { User } from 'lucide-react';
import { APP_VERSION } from './utils';
import UpdateBanner from './UpdateBanner';

export default function ProfileScreen({ onOpenAuth }: { onOpenAuth?: () => void }) {
  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 pb-[84px]">
      <UpdateBanner />
      
      {/* Auth Card */}
      <div 
        onClick={onOpenAuth}
        className="bg-[#2DB0E6] rounded-[24px] p-5 flex items-center gap-4 text-white mb-6 shadow-md shadow-blue-500/20 active:opacity-90 cursor-pointer transition-opacity"
      >
        <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center shrink-0">
          <User className="w-7 h-7 text-white" />
        </div>
        <div className="flex flex-col">
          <span className="font-bold text-lg">Вход / Регистрация</span>
        </div>
      </div>

      <div className="flex-1"></div>

      {/* Version */}
      <div className="flex justify-center pb-2">
        <span className="text-sm text-slate-400/80 font-medium font-mono">Версия приложения {APP_VERSION}</span>
      </div>
    </div>
  );
}
