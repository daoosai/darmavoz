import React, { useState, useEffect } from "react";
import toast from "react-hot-toast";
import { BarChart3, ClipboardList, LogOut } from "lucide-react";
import { NotificationToggle } from "./components/shared/NotificationToggle";
import { baseURL, handleApiError } from "./utils";
import { useAuthStore } from "./store";

interface AdminProfileScreenProps {
  onLogout: () => void;
  notificationRole?: "admin" | "logist";
}

export default function AdminProfileScreen({
  onLogout,
  notificationRole,
}: AdminProfileScreenProps) {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const token = useAuthStore((state) => state.token);
  const authRole = useAuthStore((state) => state.role);
  const effectiveNotificationRole =
    notificationRole || (authRole === "logist" ? "logist" : "admin");
  const routeBase = effectiveNotificationRole === "logist" ? "/logist" : "/admin";

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await fetch(`${baseURL}/admin/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (res.ok) {
          const data = await res.json();
          setEmail(data.email || "");
        }
      } catch (err) {
        console.error("Error fetching profile", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchProfile();
  }, [token]);

  const handleSave = async () => {
    try {
      setIsSaving(true);
      const res = await fetch(`${baseURL}/admin/me`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        toast.success("Email для уведомлений сохранен!");
      } else if (res.status === 422) {
        toast.error("Неверный формат e-mail адреса");
      } else if (res.status === 409) {
        toast.error("Этот e-mail уже используется другим пользователем");
      } else {
        toast.error("Не удалось сохранить почту");
      }
    } catch (err: any) {
      console.error(err);
      toast.error(handleApiError(err, "Ошибка при сохранении почты"));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-full pt-10">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#2DB0E6]"></div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto w-full p-4 flex flex-col gap-6 relative">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6">
          <h2 className="text-xl font-bold text-slate-800 mb-6">Профиль</h2>

          <div className="flex flex-col gap-5">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                E-mail для уведомлений
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                className="w-full bg-white border border-slate-200 text-slate-800 rounded-xl px-4 py-3 font-medium outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] transition-all"
              />
            </div>

            <button
              onClick={handleSave}
              disabled={isSaving}
              className="mt-2 w-full bg-[#2DB0E6] text-white rounded-xl py-3.5 font-bold shadow-sm shadow-blue-200 hover:bg-[#209BD6] transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isSaving ? "Сохранение..." : "Сохранить"}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-4 flex flex-col gap-3">
          <a
            href={`${routeBase}/orders`}
            className="w-full bg-slate-900 text-white rounded-2xl px-4 py-4 font-bold flex items-center justify-between gap-3 hover:bg-slate-800 transition-colors"
          >
            <span className="flex items-center gap-3">
              <ClipboardList className="w-5 h-5" />
              {"\u0421\u043f\u0438\u0441\u043e\u043a \u0437\u0430\u043a\u0430\u0437\u043e\u0432"}
            </span>
            <span className="text-white/70">{"\u041e\u0442\u043a\u0440\u044b\u0442\u044c"}</span>
          </a>
          <a
            href={`${routeBase}/statistics`}
            className="w-full bg-[#2DB0E6] text-white rounded-2xl px-4 py-4 font-bold flex items-center justify-between gap-3 hover:bg-[#209BD6] transition-colors"
          >
            <span className="flex items-center gap-3">
              <BarChart3 className="w-5 h-5" />
              {"\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043a\u0430"}
            </span>
            <span className="text-white/80">{"\u041e\u0442\u043a\u0440\u044b\u0442\u044c"}</span>
          </a>
        </div>
      </div>

      <NotificationToggle role={effectiveNotificationRole} />
      <button
        onClick={onLogout}
        className="flex items-center justify-center gap-2 w-full bg-red-50 text-red-600 rounded-xl py-3.5 font-bold hover:bg-red-100 transition-colors mt-2"
      >
        <LogOut className="w-5 h-5" />
        Выйти из аккаунта
      </button>
    </div>
  );
}