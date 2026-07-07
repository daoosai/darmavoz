import React, { useState } from "react";
import { useAuthStore, UserRole } from "./store";
import { ArrowLeft, Loader2, Eye, EyeOff } from "lucide-react";
import toast from "react-hot-toast";
import { baseURL, formatPhoneNumber } from "./utils";

interface LoginScreenProps {
  onLogin: (role: UserRole) => void;
  onBack: () => void;
}

export default function LoginScreen({ onLogin, onBack }: LoginScreenProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuthStore();

  const handleLoginChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    if (/^[\d+()\-\s]*$/.test(val) && val !== '') {
      if (val === '+') {
        setUsername('+');
        return;
      }
      setUsername(formatPhoneNumber(val));
    } else {
      setUsername(val);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      toast.error("Введите логин и пароль");
      return;
    }

    setIsLoading(true);
    try {
      const cleanLogin = username.replace(/[\s()-]/g, '');
      const formData = new URLSearchParams();
      formData.append("username", cleanLogin);
      formData.append("password", password);

      const response = await fetch(`${baseURL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      if (!response.ok) {
        throw new Error("Неверный логин или пароль");
      }

      const data = await response.json();
      const token = data.access_token;
      const role = data.role as typeof username extends string ? any : "driver" | "logist" | "admin"; // it can be "driver", "logist", etc.
      
      login(token, data.role, data.driver_id);
      onLogin(data.role);
    } catch (error) {
      toast.error("Неверный логин или пароль");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-white text-slate-900 pb-8 sm:max-w-md sm:mx-auto">
      {/* Header */}
      <div className="flex items-center p-4 border-b border-slate-100">
        <button
          onClick={onBack}
          className="p-2 -ml-2 rounded-full hover:bg-slate-50 transition-colors"
        >
          <ArrowLeft className="w-6 h-6 text-slate-700" />
        </button>
      </div>

      <div className="flex flex-col flex-1 items-center justify-center p-6">
        <h1 className="text-3xl font-black text-[#2DB0E6] mb-2 tracking-tight text-center">
          Дармавоз
        </h1>
        <h2 className="text-lg font-medium text-slate-500 mb-8 text-center">
          Сотрудники
        </h2>

        <form
          onSubmit={handleLogin}
          className="w-full max-w-sm flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">
              Логин или Телефон
            </label>
            <input
              type="text"
              name="username"
              value={username}
              onChange={handleLoginChange}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/50 transition-all"
              placeholder="Введите логин"
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
                placeholder="Введите пароль"
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
            {isLoading ? "Вход..." : "Войти"}
          </button>
        </form>
      </div>
    </div>
  );
}
