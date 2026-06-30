import React from "react";
import { X, Calendar } from "lucide-react";

interface OrdersFilterBarProps {
  date: string;
  onDateChange: (date: string) => void;
}

export const OrdersFilterBar: React.FC<OrdersFilterBarProps> = ({
  date,
  onDateChange,
}) => {
  return (
    <div className="flex flex-col sm:flex-row gap-3 items-center bg-white p-3 rounded-2xl shadow-sm border border-slate-100">
      <div className="flex items-center gap-2 text-slate-700 font-medium whitespace-nowrap">
        <Calendar className="w-5 h-5 text-slate-400" />
        <span>Фильтр по дате:</span>
      </div>
      <div className="relative flex-1 w-full sm:max-w-[200px] flex items-center">
        <input
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 transition-all text-slate-700"
        />
        {date && (
          <button
            onClick={() => onDateChange("")}
            className="absolute right-3 p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
            title="Сбросить фильтр"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};
