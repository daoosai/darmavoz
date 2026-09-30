import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, CreditCard, Download, Loader2, RefreshCw, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import CommerceShell from './CommerceShell';
import OrderPaymentsPanel from './OrderPaymentsPanel';
import { buttonClass, commerceApi, dateTime, inputClass, paymentLabels, refundLabels, rubles, shortOrder } from './commerceApi';
import { useAuthStore } from './store';
import { baseURL } from './utils';

const checkLabels: Record<string, string> = { matched: 'Совпадает', mismatch: 'Расхождение', error: 'Ошибка проверки', manual_review: 'Ручная проверка' };
export default function FinanceScreen({ onClose }: { onClose: () => void }) {
  const { role, token } = useAuthStore();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [orderQuery, setOrderQuery] = useState('');
  const [dateField, setDateField] = useState('created');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [openOrder, setOpenOrder] = useState<any>(null);
  const params = useCallback(() => {
    const p = new URLSearchParams({ date_field: dateField });
    for (const [key, value] of Object.entries({ start, end, status, method, order_query: orderQuery })) if (value) p.set(key, value);
    return p;
  }, [start, end, status, method, orderQuery, dateField]);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('');
    try {
      const p = params(); p.set('page', String(page));
      const period = params();
      const [ledger, totals] = await Promise.all([commerceApi(`/finance/payments?${p}`, { signal }), commerceApi(`/finance/summary?${period}`, { signal })]);
      setRows(ledger.items); setTotal(ledger.total); setSummary(totals);
    } catch (e: any) { if (e.name !== 'AbortError') setError(e.message); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [params, page, start, end]);
  useEffect(() => { const c = new AbortController(); void load(c.signal); return () => c.abort(); }, [load]);
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } };
  const showDetail = (id: string) => run(async () => { setDetail(await commerceApi(`/payments/${id}`)); setRefundOpen(false); setReason(''); });
  const exportCsv = () => run(async () => {
    const response = await fetch(`${baseURL}/finance/export?${params()}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) { const data = await response.json(); throw new Error(data.detail || 'Не удалось выгрузить платежи'); }
    const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = 'payments.csv'; a.click(); URL.revokeObjectURL(url);
  });
  const resetPage = (setter: (v: string) => void, v: string) => { setter(v); setPage(1); };
  return <CommerceShell title="Финансы" subtitle={summary ? `Платежи и возвраты · ${summary.timezone}` : 'Платежи, история и сверка'} wide onClose={openOrder ? () => setOpenOrder(null) : detail ? () => { setDetail(null); setRefundOpen(false); } : onClose}>
    {openOrder ? <div className="mx-auto max-w-lg rounded-3xl bg-white p-5 shadow-sm"><h2 className="text-xl font-bold">Заказ {shortOrder(openOrder.id)}</h2><p className="mt-2 text-sm text-slate-500">{openOrder.client_name} · {openOrder.delivery_address || openOrder.address}</p><p className="mt-3 text-sm">Статус: {openOrder.status}</p><p className="mt-2 text-sm">Материал: {rubles(openOrder.total_amount)} · Доставка: {rubles(openOrder.delivery_cost || 0)}</p><OrderPaymentsPanel orderId={openOrder.id} materialAmount={openOrder.total_amount} deliveryAmount={openOrder.delivery_cost || 0} /></div> : detail ? <div className="mx-auto max-w-2xl space-y-4">
      <div className="rounded-3xl bg-white p-6 shadow-sm"><div className="flex justify-between"><CreditCard className="h-8 w-8 text-sky-500" /><span className="rounded-full bg-sky-50 px-3 py-2 text-xs font-bold text-sky-600">{paymentLabels[detail.status]}</span></div><h2 className="mt-4 text-3xl font-extrabold">{rubles(detail.amount)}</h2><button className="mt-2 flex items-center gap-1 text-sm font-bold text-sky-600" onClick={() => run(async () => setOpenOrder(await commerceApi(`/orders/${detail.order_id}`)))}>Заказ {shortOrder(detail.order_id)}<ArrowUpRight className="h-4 w-4" /></button><dl className="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">{[['Создан', dateTime(detail.created_at)], ['Оплачен', dateTime(detail.paid_at)], ['Способ', detail.payment_method || '—'], ['Сверка', checkLabels[detail.reconciliation_status] || 'Не проверен'], ['Последняя проверка', dateTime(detail.checked_at)], ['Чек', detail.receipt_status || '—'], ['Чек зачёта', detail.settlement_receipt_status || '—'], ['Возврат', refundLabels[detail.refund_status] || '—']].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>)}</dl><p className="mt-4 break-all text-xs text-slate-400">ЮKassa: {detail.provider_id || 'Идентификатор ещё не получен'}</p>{detail.needs_review && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Требуется решение по возврату или проверка расхождения.</p>}
        {role === 'admin' && <div className="mt-5 flex flex-wrap gap-2"><button disabled={busy} className={buttonClass} onClick={() => run(async () => { await commerceApi(`/payments/${detail.id}/refresh`, { method: 'POST' }); setDetail(await commerceApi(`/payments/${detail.id}`)); await load(); })}><RefreshCw className="h-4 w-4" />Сверить</button>{detail.status === 'succeeded' && !['creating', 'unknown', 'pending', 'succeeded'].includes(detail.refund_status) && <button className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700" onClick={() => setRefundOpen(!refundOpen)}><RotateCcw className="h-4 w-4" />Полный возврат</button>}</div>}
        {refundOpen && <form className="mt-4 space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4" onSubmit={e => { e.preventDefault(); void run(async () => { await commerceApi(`/payments/${detail.id}/refund`, { method: 'POST', body: JSON.stringify({ reason }) }); setDetail(await commerceApi(`/payments/${detail.id}`)); setRefundOpen(false); await load(); toast.success('Возврат отправлен'); }); }}><p className="text-sm font-bold text-amber-900">Вернуть покупателю всю сумму: {rubles(detail.amount)}</p><textarea required minLength={3} maxLength={2000} className={inputClass} placeholder="Причина возврата" value={reason} onChange={e => setReason(e.target.value)} /><label className="flex items-center gap-2 text-sm text-amber-900"><input required type="checkbox" />Подтверждаю полный возврат</label><button disabled={busy} className={buttonClass}>Подтвердить возврат</button></form>}
      </div><div className="rounded-3xl bg-white p-5"><h3 className="mb-4 font-bold">История платежа</h3>{detail.events.map((e: any, i: number) => <div key={i} className="mb-4 border-l-2 border-sky-100 pl-4"><p className="text-xs text-slate-400">{dateTime(e.created_at)}</p><p className="mt-1 text-sm">{e.description}</p></div>)}{detail.refunds.map((r: any) => <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm" key={r.id}>{refundLabels[r.status]} · {rubles(r.amount)} · {r.reason}</p>)}</div>
    </div> : <>
      {summary && <><div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{[['Оплачено', summary.paid, 'text-sky-600'], ['Возвращено', summary.refunded, 'text-amber-600'], ['После возвратов', summary.net, 'text-emerald-600']].map(([label, amount, color]) => <div key={label} className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm"><p className="text-xs font-semibold text-slate-500">{label}</p><p className={`mt-2 break-words text-2xl font-extrabold ${color}`}>{rubles(amount)}</p></div>)}</div><p className="text-xs text-slate-500">За период по датам успешных операций: {summary.successful_count} оплат · {summary.failed_count} неуспешных попыток. Комиссии и выплаты партнёрам не включены.</p></>}
      <div className="space-y-3 rounded-3xl bg-white p-4 shadow-sm"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><label className="text-xs text-slate-500">С даты<input type="date" className={`${inputClass} mt-1`} value={start} onChange={e => resetPage(setStart, e.target.value)} /></label><label className="text-xs text-slate-500">По дату<input type="date" className={`${inputClass} mt-1`} value={end} onChange={e => resetPage(setEnd, e.target.value)} /></label><label className="text-xs text-slate-500">Дата в реестре<select className={`${inputClass} mt-1`} value={dateField} onChange={e => resetPage(setDateField, e.target.value)}><option value="created">Создания</option><option value="paid">Оплаты</option></select></label><label className="text-xs text-slate-500">Статус<select className={`${inputClass} mt-1`} value={status} onChange={e => resetPage(setStatus, e.target.value)}><option value="">Все статусы</option>{Object.entries(paymentLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><input aria-label="Номер заказа" className={inputClass} placeholder="Номер заказа / часть UUID" value={orderQuery} onChange={e => resetPage(setOrderQuery, e.target.value)} /><select aria-label="Способ оплаты" className={inputClass} value={method} onChange={e => resetPage(setMethod, e.target.value)}><option value="">Все способы оплаты</option><option value="bank_card">Банковская карта</option><option value="sbp">СБП</option><option value="sberbank">SberPay</option><option value="yoo_money">ЮMoney</option></select></div><div className="flex flex-wrap gap-2"><button disabled={busy} className={buttonClass} onClick={exportCsv}><Download className="h-4 w-4" />CSV</button>{role === 'admin' && <button disabled={busy} className="flex items-center gap-2 rounded-xl bg-sky-50 px-4 py-3 text-sm font-bold text-sky-700" onClick={() => run(async () => { const result = await commerceApi('/finance/reconcile', { method: 'POST' }); await load(); toast.success(`Проверено: ${result.checked}`); })}><RefreshCw className="h-4 w-4" />Сверка с ЮKassa</button>}</div></div>
      {loading ? <Loader2 className="mx-auto my-12 h-8 w-8 animate-spin text-sky-500" /> : error ? <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-600">{error}<button className="ml-3 underline" onClick={() => load()}>Повторить</button></div> : !rows.length ? <div className="rounded-3xl bg-white py-14 text-center"><CreditCard className="mx-auto mb-3 h-12 w-12 text-slate-200" /><h2 className="font-bold">Платежей пока нет</h2><p className="mt-2 text-sm text-slate-500">Здесь появятся оплаты заказов. Попробуйте изменить фильтры.</p></div> : <>
        <div className="hidden overflow-x-auto rounded-3xl bg-white p-3 shadow-sm md:block"><table className="w-full text-left text-sm"><thead className="border-b border-slate-100 text-xs text-slate-400"><tr>{['Дата', 'Клиент', 'Заказ', 'Сумма', 'Способ', 'Статус', 'Сверка'].map(h => <th className="p-3 font-semibold" key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(p => <tr key={p.id} className="cursor-pointer border-b border-slate-50 hover:bg-sky-50/50" onClick={() => showDetail(p.id)}><td className="p-3">{dateTime(dateField === 'paid' ? p.paid_at : p.created_at)}</td><td className="p-3">{p.client_name}</td><td className="p-3 font-bold text-sky-600"><button onClick={() => showDetail(p.id)}>{shortOrder(p.order_id)}</button></td><td className="p-3 font-bold">{rubles(p.amount)}</td><td className="p-3">{p.payment_method || '—'}</td><td className="p-3">{p.refund_status ? refundLabels[p.refund_status] : paymentLabels[p.status]}</td><td className="p-3 text-xs">{checkLabels[p.reconciliation_status] || '—'}</td></tr>)}</tbody></table></div>
        <div className="space-y-3 md:hidden">{rows.map(p => <button key={p.id} className="w-full rounded-3xl bg-white p-5 text-left shadow-sm" onClick={() => showDetail(p.id)}><div className="flex justify-between gap-2"><span className="text-xs text-slate-400">{shortOrder(p.order_id)}</span><span className="text-xs font-bold text-sky-600">{p.refund_status ? refundLabels[p.refund_status] : paymentLabels[p.status]}</span></div><h3 className="mt-3 text-xl font-extrabold">{rubles(p.amount)}</h3><p className="mt-2 break-words text-sm">{p.client_name}</p><p className="mt-2 text-xs text-slate-400">{dateTime(p.created_at)} · {p.payment_method || 'Способ ещё не определён'}</p></button>)}</div>
      </>}
      {total > 20 && <div className="flex justify-between"><button className={buttonClass} disabled={page === 1} onClick={() => setPage(page - 1)}>Назад</button><span className="self-center text-sm text-slate-500">{page} / {Math.ceil(total / 20)}</span><button className={buttonClass} disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>Далее</button></div>}
    </>}
  </CommerceShell>;
}
