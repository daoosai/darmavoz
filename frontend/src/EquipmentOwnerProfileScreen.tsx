import { useEffect, useState, type FormEvent } from "react";
import { Loader2, LogOut, Mail, Phone, Tractor } from "lucide-react";
import toast from "react-hot-toast";

import { baseURL, extractApiErrorMessage, formatPhoneNumber } from "./utils";

interface Props {
  token: string;
  onLogout: () => Promise<void>;
}

export default function EquipmentOwnerProfileScreen({ token, onLogout }: Props) {
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const response = await fetch(`${baseURL}/equipment-owner/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(extractApiErrorMessage(data, "Не удалось загрузить профиль"));
        }
        setPhone(data.phone || "");
        setEmail(data.email || "");
        setDisplayName(data.display_name || "");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Не удалось загрузить профиль");
      } finally {
        setIsLoading(false);
      }
    };

    void fetchProfile();
  }, [token]);

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      const response = await fetch(`${baseURL}/equipment-owner/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ display_name: displayName.trim() || null }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data, "Не удалось сохранить профиль"));
      }
      setPhone(data.phone || "");
      setEmail(data.email || "");
      setDisplayName(data.display_name || "");
      toast.success("Профиль сохранен");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить профиль");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <Loader2 className="mx-auto mt-20 h-8 w-8 animate-spin text-sky-500" />;
  }

  return (
    <div className="px-5 pb-8 pt-[max(env(safe-area-inset-top),1rem)] text-gray-900">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-500">
        Кабинет владельца спецтехники
      </p>
      <h1 className="mt-1 text-3xl font-black">Профиль</h1>

      <form onSubmit={saveProfile} className="mt-8 space-y-5 rounded-2xl bg-white p-5 shadow-sm">
        <label className="block text-sm font-bold text-gray-900">
          Номер телефона
          <span className="mt-2 flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4">
            <Phone className="h-5 w-5 text-gray-400" />
            <input
              readOnly
              value={phone ? formatPhoneNumber(phone) : "Не указан"}
              className="w-full bg-transparent py-4 text-gray-500 outline-none"
            />
          </span>
        </label>

        {email ? (
          <label className="block text-sm font-bold text-gray-900">
            Электронная почта
            <span className="mt-2 flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4">
              <Mail className="h-5 w-5 text-gray-400" />
              <input
                readOnly
                value={email}
                className="w-full bg-transparent py-4 text-gray-500 outline-none"
              />
            </span>
          </label>
        ) : null}

        <label className="block text-sm font-bold text-gray-900">
          ФИО / Название компании
          <span className="mt-2 flex items-center gap-3 rounded-xl border border-gray-200 px-4 focus-within:border-sky-500">
            <Tractor className="h-5 w-5 text-sky-500" />
            <input
              maxLength={255}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="ООО Спецтехника"
              className="w-full bg-transparent py-4 text-gray-900 outline-none"
            />
          </span>
        </label>

        <button
          disabled={isSaving}
          className="flex w-full items-center justify-center rounded-xl bg-sky-500 py-4 font-bold text-white hover:bg-sky-600 disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : "Сохранить"}
        </button>
      </form>

      <button
        type="button"
        disabled={isLoggingOut}
        onClick={async () => {
          setIsLoggingOut(true);
          await onLogout();
        }}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-red-50 py-4 font-bold text-red-600 hover:bg-red-100 disabled:opacity-50"
      >
        {isLoggingOut ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogOut className="h-5 w-5" />}
        Выйти из аккаунта
      </button>
    </div>
  );
}
