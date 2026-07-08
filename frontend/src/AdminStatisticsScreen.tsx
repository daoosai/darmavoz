import React from "react";
import { ArrowLeft, BarChart3 } from "lucide-react";

interface AdminStatisticsScreenProps {
  role: "admin" | "logist";
}

export default function AdminStatisticsScreen({
  role,
}: AdminStatisticsScreenProps) {
  const routeBase = role === "logist" ? "/logist" : "/admin";
  const title =
    role === "logist"
      ? "\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043a\u0430 \u043b\u043e\u0433\u0438\u0441\u0442\u0430"
      : "\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043a\u0430 \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0430";

  return (
    <div className="min-h-screen bg-slate-50 flex sm:items-center justify-center px-4 py-6">
      <div className="w-full max-w-md bg-white min-h-[70vh] sm:min-h-0 sm:h-auto sm:rounded-[32px] sm:border-8 border-slate-900 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-white sticky top-0 z-10">
          <a
            href={routeBase}
            className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {"\u041d\u0430\u0437\u0430\u0434"}
          </a>
          <div className="mt-4 flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#2DB0E6]/10 text-[#2DB0E6] flex items-center justify-center">
              <BarChart3 className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900">{title}</h1>
              <p className="text-sm text-slate-500">
                {"\u042d\u043a\u0440\u0430\u043d \u043f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043b\u0435\u043d \u0434\u043b\u044f \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u044f \u0430\u043d\u0430\u043b\u0438\u0442\u0438\u043a\u0438."}
              </p>
            </div>
          </div>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-600 leading-relaxed">
            {"\u0417\u0434\u0435\u0441\u044c \u0431\u0443\u0434\u0435\u0442 \u0441\u0432\u043e\u0434\u043d\u0430\u044f \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043a\u0430 \u043f\u043e \u0437\u0430\u043a\u0430\u0437\u0430\u043c, \u0432\u044b\u0440\u0443\u0447\u043a\u0435, \u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044f\u043c \u0438 \u0430\u043a\u0442\u0438\u0432\u043d\u044b\u043c \u0441\u043c\u0435\u043d\u0430\u043c."}
          </div>

          <a
            href={`${routeBase}/orders`}
            className="w-full bg-[#2DB0E6] text-white rounded-2xl px-4 py-4 font-bold flex items-center justify-between gap-3 hover:bg-[#209BD6] transition-colors"
          >
            <span>{"\u041f\u0435\u0440\u0435\u0439\u0442\u0438 \u043a \u0437\u0430\u043a\u0430\u0437\u0430\u043c"}</span>
            <span className="text-white/80">{"\u041e\u0442\u043a\u0440\u044b\u0442\u044c"}</span>
          </a>
        </div>
      </div>
    </div>
  );
}