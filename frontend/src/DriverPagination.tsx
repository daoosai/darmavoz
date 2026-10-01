export default function DriverPagination({ page, hasMore, onChange }: { page: number; hasMore: boolean; onChange: (page: number) => void }) {
  return <div className="mb-3 flex items-center justify-between rounded-2xl border border-slate-100 bg-white p-3 text-sm shadow-sm">
    <button type="button" disabled={page === 0} onClick={() => onChange(page - 1)} className="rounded-xl bg-slate-50 px-3 py-2 font-semibold text-slate-600 disabled:opacity-40">Назад</button>
    <span className="text-slate-500">Страница {page + 1}</span>
    <button type="button" disabled={!hasMore} onClick={() => onChange(page + 1)} className="rounded-xl bg-sky-50 px-3 py-2 font-semibold text-sky-700 disabled:opacity-40">Далее</button>
  </div>;
}
