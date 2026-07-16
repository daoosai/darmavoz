import React, { useEffect, useState } from "react";
import {
  User,
  MapPin,
  LogOut,
  Loader2,
  Edit2,
  ChevronLeft,
  PackageCheck,
  History,
  PhoneCall,
  Headphones,
} from "lucide-react";
import { NotificationToggle } from "./components/shared/NotificationToggle";
import { logoutCurrentSession } from "./pushAuth";
import { baseURL, APP_VERSION, handleApiError } from "./utils";
import { useAuthStore } from "./store";
import toast from "react-hot-toast";

interface ClientData {
  id: string;
  name: string;
  phone: string;
}

interface ClientProfileScreenProps {
  onOpenAddresses?: () => void;
  onOpenSupport?: () => void;
}

export default function ClientProfileScreen({
  onOpenAddresses,
  onOpenSupport,
}: ClientProfileScreenProps) {
  const { token } = useAuthStore();
  const [client, setClient] = useState<ClientData | null>(null);
  const [stats, setStats] = useState({ active: 0, total: 0 });
  const [isLoading, setIsLoading] = useState(true);

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchData = async () => {
    try {
      const [clientRes, ordersRes] = await Promise.all([
        fetch(`${baseURL}/clients/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${baseURL}/clients/me/orders`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (clientRes.ok) {
        setClient(await clientRes.json());
      }

      if (ordersRes.ok) {
        const orders = await ordersRes.json();
        if (Array.isArray(orders)) {
          setStats({
            total: orders.length,
            active: orders.filter(
              (o: any) =>
                o.status !== "completed" &&
                o.status !== "delivered" &&
                o.status !== "cancelled" &&
                o.status !== "canceled",
            ).length,
          });
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (token) fetchData();
  }, [token]);

  const openEditModal = () => {
    const parts = (client?.name || "").split(" ");
    setFirstName(parts[0] || "");
    setLastName(parts.slice(1).join(" ") || "");
    setIsEditModalOpen(true);
  };

  const handleSaveProfile = async () => {
    const newName = `${firstName.trim()} ${lastName.trim()}`.trim();
    if (!newName) {
      toast.error("Имя не может быть пустым");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`${baseURL}/clients/me`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: newName }),
      });

      if (res.ok) {
        toast.success("Данные обновлены");
        setIsEditModalOpen(false);
        fetchData();
      } else {
        toast.error("Ошибка при сохранении");
      }
    } catch (e: any) {
      toast.error(handleApiError(e, "Сетевая ошибка"));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex justify-center items-center h-full bg-gray-50">
        <Loader2 className="w-8 h-8 text-[#2DB0E6] animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-68px)] flex-col bg-gray-50 pb-24">
      {/* Gradient Header */}
      <div className="bg-gradient-to-r from-[#2DB0E6] to-[#1D99D4] text-white p-6 pb-10 rounded-b-[32px] shadow-md relative z-10 flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center shrink-0 backdrop-blur-sm">
          <User className="w-8 h-8 text-white" />
        </div>
        <div className="flex flex-col flex-1">
          <h2 className="text-xl font-bold leading-tight">
            {client?.name || "Имя не указано"}
          </h2>
          <span className="text-white/80 font-medium mt-1">
            {client?.phone || "+7 (___) ___ __ __"}
          </span>
        </div>
        <button
          onClick={openEditModal}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-sm transition-colors shrink-0"
        >
          <Edit2 className="w-5 h-5 text-white" />
        </button>
      </div>

      {/* Mini Dashboard */}
      <div className="grid grid-cols-2 gap-4 px-4 -mt-4 relative z-20">
        <div className="bg-white rounded-2xl shadow-sm p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <PackageCheck className="w-5 h-5 text-[#2DB0E6]" />
            <span className="text-sm font-medium text-slate-500">Активные</span>
          </div>
          <span className="text-2xl font-bold text-slate-900">
            {stats.active}
          </span>
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-[#2DB0E6]" />
            <span className="text-sm font-medium text-slate-500">
              Всего заказов
            </span>
          </div>
          <span className="text-2xl font-bold text-slate-900">
            {stats.total}
          </span>
        </div>
      </div>

      {/* Useful Actions */}
      <div className="px-4 mt-6 flex flex-col gap-3">
        <button
          onClick={onOpenAddresses}
          className="w-full bg-white p-4 rounded-2xl shadow-sm flex items-center gap-4 active:scale-[0.98] transition-transform"
        >
          <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
            <MapPin className="w-5 h-5 text-[#2DB0E6]" />
          </div>
          <span className="font-semibold text-slate-800 text-left flex-1">
            Мои адреса
          </span>
        </button>

        <button
          onClick={() => (window.location.href = "tel:+79000000000")}
          className="w-full bg-white p-4 rounded-2xl shadow-sm flex items-center gap-4 active:scale-[0.98] transition-transform"
        >
          <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center shrink-0">
            <PhoneCall className="w-5 h-5 text-green-500" />
          </div>
          <span className="font-semibold text-slate-800 text-left flex-1">
            Позвонить диспетчеру
          </span>
        </button>

        <button
          onClick={onOpenSupport}
          className="w-full bg-white p-4 rounded-2xl shadow-sm flex items-center gap-4 active:scale-[0.98] transition-transform"
        >
          <div className="w-10 h-10 rounded-full bg-sky-50 flex items-center justify-center shrink-0">
            <Headphones className="w-5 h-5 text-sky-500" />
          </div>
          <span className="font-semibold text-slate-800 text-left flex-1">
            Поддержка
          </span>
        </button>
      </div>
      <div className="px-4">
        <NotificationToggle role="client" />
      </div>

      {/* Footer Area */}
      <div className="px-4 mt-8 pt-6 flex flex-col items-center bg-transparent">
        <button
          onClick={async () => await logoutCurrentSession()}
          className="w-full bg-white border border-slate-200 text-slate-600 font-bold py-3.5 rounded-2xl flex items-center justify-center gap-2 active:bg-slate-50 transition-colors"
        >
          <LogOut className="w-5 h-5" />
          Выйти
        </button>
        <div className="text-xs font-medium text-slate-400 mt-4 text-center pb-4">
          Дармавоз.рф • Версия {APP_VERSION}
        </div>
      </div>

      {/* Edit Profile Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setIsEditModalOpen(false)}
          />

          <div className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl relative z-10 flex flex-col max-h-[90vh]">
            <div className="w-full flex justify-center pt-3 pb-2 sm:hidden">
              <div className="w-12 h-1.5 bg-slate-200 rounded-full"></div>
            </div>

            <div className="px-6 py-4 flex items-center gap-4 border-b border-slate-50">
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-2 -ml-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-colors"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <h2 className="text-[20px] font-bold text-slate-900">
                Личные данные
              </h2>
            </div>

            <div className="p-6 flex flex-col gap-6 overflow-y-auto">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2 ml-1">
                  Имя
                </label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-[15px] font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6]/50 transition-all"
                  placeholder="Ваше имя"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2 ml-1">
                  Фамилия
                </label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-[15px] font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6]/50 transition-all"
                  placeholder="Ваша фамилия"
                />
              </div>
            </div>

            <div className="p-6 pt-2 pb-8 sm:pb-6 mt-auto">
              <button
                onClick={handleSaveProfile}
                disabled={isSubmitting}
                className="w-full bg-[#2DB0E6] text-white py-4 rounded-full font-bold text-lg active:scale-[0.98] transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSubmitting && <Loader2 className="w-5 h-5 animate-spin" />}
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
