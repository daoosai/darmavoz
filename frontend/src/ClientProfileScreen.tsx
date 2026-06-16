import React, { useEffect, useState } from "react";
import { User, MapPin, MessageCircle, Share2, Info, Star, ChevronRight, LogOut, Loader2, PieChart } from "lucide-react";
import { baseURL } from "./utils";
import { useAuthStore } from "./store";

interface ClientData {
  id: string;
  name: string;
  phone: string;
  email: string;
}

export default function ClientProfileScreen() {
  const { token, logout } = useAuthStore();
  const [client, setClient] = useState<ClientData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchClient = async () => {
      try {
        const res = await fetch(`${baseURL}/clients/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (res.ok) {
          const data = await res.json();
          setClient(data);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    if (token) fetchClient();
  }, [token]);

  if (isLoading) {
    return (
      <div className="flex-1 flex justify-center items-center h-full bg-slate-50">
        <Loader2 className="w-8 h-8 text-[#2DB0E6] animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 pb-24 overflow-y-auto">
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <User className="w-6 h-6 text-slate-400" />
          <h2 className="text-[20px] font-bold text-slate-900">{client?.name || "Имя не указано"}</h2>
        </div>
        <div className="flex flex-col gap-2 relative pl-9">
          <div className="text-[15px] font-medium text-slate-700">{client?.phone || "+7 (___) ___ __ __"}</div>
          <div className="text-[15px] font-medium text-slate-700">{client?.email || "email@не_указан.ru"}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-center items-center gap-2 cursor-pointer active:scale-95 transition-transform">
          <MapPin className="w-8 h-8 text-[#2DB0E6]" />
          <span className="font-bold text-sm text-slate-800 text-center leading-tight mt-1">Мои адреса</span>
        </div>
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-center items-center gap-2 cursor-pointer active:scale-95 transition-transform relative overflow-hidden">
          <MessageCircle className="w-8 h-8 text-[#e63946]" />
          <span className="font-bold text-sm text-slate-800 text-center leading-tight mt-1">Чат с оператором</span>
          <div className="absolute top-3 right-3 w-3 h-3 bg-red-500 rounded-full border-2 border-white"></div>
        </div>
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col items-start gap-1 relative overflow-hidden h-28 cursor-pointer active:scale-95 transition-transform">
          <span className="font-bold text-sm text-slate-800">Мои баллы</span>
          <span className="text-2xl font-black text-slate-900">0</span>
          <div className="absolute -bottom-4 -right-4 text-[#2DB0E6] opacity-30">
             <PieChart className="w-20 h-20" />
          </div>
        </div>
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col items-start gap-1 relative overflow-hidden h-28 cursor-pointer active:scale-95 transition-transform">
          <span className="font-bold text-sm text-slate-800">Пригласи<br/>друга</span>
          <span className="text-xl border border-slate-100 bg-slate-50 px-2 py-0.5 rounded-lg font-black text-slate-900">100</span>
          <div className="absolute -bottom-2 -right-2 text-slate-200">
             <Share2 className="w-16 h-16" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl flex flex-col overflow-hidden border border-slate-100 shadow-sm mb-8">
        <button className="flex items-center justify-between p-4 bg-white active:bg-slate-50 transition-colors w-full text-left">
          <span className="font-medium text-slate-800">Оцените нас</span>
          <ChevronRight className="w-5 h-5 text-slate-300" />
        </button>
        <div className="h-[1px] bg-slate-100 mx-4"></div>
        <button className="flex items-center justify-between p-4 bg-white active:bg-slate-50 transition-colors w-full text-left">
          <span className="font-medium text-slate-800">О компании</span>
          <ChevronRight className="w-5 h-5 text-slate-300" />
        </button>
      </div>

      {/* spacer to push logout to bottom */}
      <div className="flex-1"></div>

      <button 
        onClick={() => logout()}
        className="w-full bg-white border border-[#e63946] text-[#e63946] font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 mt-4 active:bg-red-50 transition-colors"
      >
        <LogOut className="w-5 h-5" />
        Выйти
      </button>
    </div>
  );
}
