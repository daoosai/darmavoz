import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { LogOut } from "lucide-react";
import { baseURL, handleApiError } from "./utils";
import { useAuthStore } from "./store";
import DeleteAccountButton from "./components/shared/DeleteAccountButton";

interface AdminProfileScreenProps {
  onLogout: () => void;
}

export default function AdminProfileScreen({
  onLogout,
}: AdminProfileScreenProps) {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const token = useAuthStore((state) => state.token);

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

      <button
        onClick={onLogout}
        className="flex items-center justify-center gap-2 w-full bg-red-50 text-red-600 rounded-xl py-3.5 font-bold hover:bg-red-100 transition-colors mt-2"
      >
        <LogOut className="w-5 h-5" />
        Выйти из аккаунта
      </button>
      <DeleteAccountButton token={token} onDeleted={onLogout} />
    </div>
  );
}
