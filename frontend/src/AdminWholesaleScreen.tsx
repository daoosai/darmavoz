import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, RefreshCw, X } from 'lucide-react';
import toast from 'react-hot-toast';
import WholesaleRequestCard, { type WholesaleCardData, wholesaleStates } from './WholesaleRequestCard';
import ReasonModal from './components/admin/ReasonModal';
import { commerceApi, dateTime, inputClass } from './commerceApi';

interface Announcement extends WholesaleCardData { id: string; status: string }
const filters = [['pending', 'На модерации'], ['approved', 'Активные'], ['rejected', 'Отклонённые'], ['archived', 'Архив'], ['all', 'Все']] as const;

// Render inside AdminDashboard: retain its header, navigation and notification centre.
export default function AdminWholesaleScreen() {
  const [status, setStatus] = useState('pending');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Announcement[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<Announcement | null>(null);
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState<Announcement | null>(null);
  const [history, setHistory] = useState<{ status: string; reason?: string; created_at: string }[]>([]);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ view: 'moderation', status, q, page: String(page) });
      const result = await commerceApi(`/wholesale-requests?${params}`, { signal });
      if (!signal?.aborted) { setRows(result.items); setTotal(result.total); }
    } catch (e: any) { if (e.name !== 'AbortError') setError(e.message); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [status, q, page]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const open = useCallback(async (id: string, signal?: AbortSignal) => {
    try {
      const [request, events] = await Promise.all([
        commerceApi(`/wholesale-requests/${id}`, { signal }),
        commerceApi(`/wholesale-requests/${id}/history`, { signal }),
      ]);
      if (!signal?.aborted) { setDetail(request); setHistory(events); }
    } catch (e: any) { if (e.name !== 'AbortError') toast.error(e.message); }
  }, []);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('notification_wholesale');
    const controller = new AbortController();
    if (id && /^[0-9a-f-]{36}$/i.test(id)) void open(id, controller.signal);
    return () => controller.abort();
  }, [open]);
  const moderate = async (request: Announcement, action: 'approve' | 'reject') => {
    setBusy(true);
    try {
      const updated = await commerceApi(`/wholesale-requests/${request.id}/moderate`, {
        method: 'POST', body: JSON.stringify({ action, ...(action === 'reject' ? { reason: reason.trim() } : {}) }),
      });
      if (detail?.id === request.id) await open(updated.id);
      setRejecting(null); setReason('');
      await load();
      toast.success(action === 'approve' ? 'Заявка одобрена' : 'Заявка отклонена');
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  const card = (request: Announcement) => <div key={request.id}><WholesaleRequestCard request={request}
    onOpen={detail ? undefined : () => void open(request.id)}
    footer={request.status === 'pending' ? <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
      <button disabled={busy} onClick={() => void moderate(request, 'approve')} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-green-600 px-5 py-3 font-bold text-white hover:bg-green-700 disabled:opacity-50"><Check className="h-5 w-5" />Одобрить</button>
      <button disabled={busy} onClick={() => { setRejecting(request); setReason(''); }} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-3 font-bold text-white hover:bg-red-700 disabled:opacity-50"><X className="h-5 w-5" />Отклонить</button>
    </div> : undefined} /></div>;
  return <section aria-label="Модерация оптовых заявок" className="min-w-0 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-2xl font-bold text-slate-800">Оптовые заявки</h2><p className="mt-1 text-sm text-slate-500">Проверка и публикация объявлений партнёров</p></div>
      <button disabled={loading || busy} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-3 text-sm font-bold text-slate-600 disabled:opacity-50" onClick={() => void load()}><RefreshCw className="h-4 w-4" />Обновить</button>
    </div>
    {detail ? <>
      <button className="text-sm font-bold text-sky-600" onClick={() => { setDetail(null); setHistory([]); }}>К списку заявок</button>
      {card(detail)}
      <div className="rounded-2xl border border-slate-100 bg-white p-5"><h3 className="mb-3 font-bold">История</h3>{history.map((event, i) => <p key={i} className="mb-2 text-sm text-slate-500">{dateTime(event.created_at)} · {wholesaleStates[event.status]} {event.reason && `— ${event.reason}`}</p>)}</div>
    </> : <>
      <div className="flex flex-wrap gap-2" aria-label="Статус заявок">{filters.map(([value, label]) => <button key={value} aria-pressed={status === value} className={`min-h-11 rounded-xl px-4 py-3 text-sm font-bold ${status === value ? 'bg-sky-600 text-white' : 'border bg-white text-slate-600'}`} onClick={() => { setStatus(value); setPage(1); }}>{label}</button>)}</div>
      <input className={inputClass} aria-label="Поиск материала" placeholder="Поиск материала" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} />
      {error ? <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error}<button className="ml-3 underline" onClick={() => void load()}>Повторить</button></div>
        : loading ? <Loader2 aria-label="Загрузка заявок" className="mx-auto h-8 w-8 animate-spin text-sky-500" />
        : rows.length ? <div className="space-y-4">{rows.map(card)}</div>
        : <div className="rounded-2xl border bg-white p-8 text-center text-slate-500">В этом статусе заявок пока нет</div>}
      {total > 20 && <div className="flex items-center justify-between gap-3"><button disabled={page === 1 || busy} onClick={() => setPage(page - 1)}>Назад</button><span>{page} / {Math.ceil(total / 20)}</span><button disabled={page * 20 >= total || busy} onClick={() => setPage(page + 1)}>Далее</button></div>}
    </>}
    <ReasonModal isOpen={!!rejecting} title="Причина отклонения" subject={rejecting?.material_name} label="Причина отклонения" value={reason} maxLength={2000} submitLabel="Отклонить заявку" isSubmitting={busy} submitDisabled={!reason.trim()} onChange={setReason} onClose={() => { if (!busy) setRejecting(null); }} onSubmit={e => { e.preventDefault(); if (rejecting && reason.trim()) void moderate(rejecting, 'reject'); }} />
  </section>;
}
