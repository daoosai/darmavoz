import React, { useState } from "react";
import { ArrowLeft, Loader2, Eye, EyeOff } from "lucide-react";
import toast from "react-hot-toast";
import { baseURL, formatPhoneNumber } from "./utils";
import { useAuthStore, UserRole } from "./store";

interface DriverRegistrationScreenProps {
  onRegister: (role: UserRole) => void;
  onBack: () => void;
}

export default function DriverRegistrationScreen({ onRegister, onBack }: DriverRegistrationScreenProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const cleanPhone = phone.replace(/[^\d+]/g, ''); // Очистка маски
      
      const response = await fetch(`${baseURL}/auth/driver/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name,
          phone: cleanPhone,
          password: password
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || "Ошибка регистрации");
      }

      const data = await response.json();
      
      // Бэкенд возвращает access_token и role. Сохраняем их!
      if (data.access_token) {
        useAuthStore.getState().login(data.access_token, data.role || 'driver');
        toast.success("Регистрация успешна!");
        // Редирект на экран логина ЗДЕСЬ БЫТЬ НЕ ДОЛЖНО!
        // Глобальный роутер сам перекинет водителя в профиль благодаря изменению стейта.
      } else {
        throw new Error("Токен не получен от сервера");
      }

    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Сбой при регистрации");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-white text-slate-900 pb-8 sm:max-w-md sm:mx-auto">
      <div className="flex items-center p-4 border-b border-slate-100">
        <button
          onClick={onBack}
          className="p-2 -ml-2 rounded-full hover:bg-slate-50 transition-colors"
        >
          <ArrowLeft className="w-6 h-6 text-slate-700" />
        </button>
      </div>

      <div className="flex flex-col flex-1 items-center justify-center p-6 -mt-10">
        <h1 className="text-3xl font-black text-[#2DB0E6] mb-2 tracking-tight text-center">
          Регистрация
        </h1>
        <h2 className="text-lg font-medium text-slate-500 mb-8 text-center leading-tight">
          Введите свои данные для создания аккаунта водителя
        </h2>

        <form
          onSubmit={handleSubmit}
          className="w-full max-w-sm flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">ФИО</label>
            <input
              type="text"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/50 transition-all"
              placeholder="Иванов Иван Иванович"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Номер телефона</label>
            <input
              type="tel"
              name="phone"
              value={phone}
              onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/50 transition-all"
              placeholder="+7 (999) 000-00-00"
              maxLength={18}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Пароль</label>
            <div className="relative w-full">
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 pr-12 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/50 transition-all"
                placeholder="Придумайте пароль"
              />
              <button
                type="button"
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className={`w-full text-white rounded-xl py-4 font-bold text-lg mt-4 shadow-sm transition-all flex items-center justify-center gap-2 ${
              isLoading
                ? "bg-[#2DB0E6]/70 cursor-not-allowed"
                : "bg-[#2DB0E6] active:bg-[#209BD6] hover:bg-[#209BD6]"
            }`}
          >
            {isLoading && <Loader2 className="w-5 h-5 animate-spin" />}
            {isLoading ? "Регистрация..." : "Зарегистрироваться"}
          </button>
        </form>
      </div>
    </div>
  );
}
