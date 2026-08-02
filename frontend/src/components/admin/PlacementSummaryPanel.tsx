import { useEffect } from "react";

import { usePlacementStore } from "../../store";

export default function PlacementSummaryPanel({
  token,
  onOpenPoints,
  onOpenEquipment,
}: {
  token: string;
  onOpenPoints: () => void;
  onOpenEquipment: () => void;
}) {
  const { summary, isLoading, loadSummary } = usePlacementStore();

  useEffect(() => {
    void loadSummary(token);
  }, [loadSummary, token]);

  if (isLoading && !summary) {
    return <div className="rounded-2xl bg-white p-5 text-sm text-slate-500 shadow-sm">Загружаем сводку размещений…</div>;
  }
  if (!summary) return null;

  const cards = [
    ["Активные карьеры", summary.active_quarries, onOpenPoints],
    ["Активные накопители", summary.active_accumulators, onOpenPoints],
    ["Активная спецтехника", summary.active_equipment, onOpenEquipment],
    ["Тестовый период", summary.totals.trial, onOpenPoints],
    ["Требует подтверждения", summary.totals.confirmation_required, onOpenPoints],
    ["Скрыто", summary.totals.hidden, onOpenPoints],
    ["Размещение завершено", summary.totals.expired, onOpenPoints],
    ["Архив", summary.totals.archived, onOpenPoints],
  ] as const;

  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900">Актуальность размещений</h2>
          <p className="text-xs text-slate-500">Продление по умолчанию: {summary.policy.extension_days} дней</p>
        </div>
        <button type="button" onClick={() => void loadSummary(token)} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">Обновить</button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map(([label, value, onClick]) => (
          <button key={label} type="button" onClick={onClick} className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-left transition hover:border-sky-200 hover:bg-sky-50">
            <div className="text-2xl font-black text-slate-900">{value}</div>
            <div className="mt-1 text-xs font-semibold text-slate-600">{label}</div>
          </button>
        ))}
      </div>
    </section>
  );
}
