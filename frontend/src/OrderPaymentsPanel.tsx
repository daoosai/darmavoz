import { useCallback, useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { CreditCard, History, Loader2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { buttonClass, commerceApi, dateTime, inputClass, paymentLabels, refundLabels, rubles } from './commerceApi';
import { useAuthStore } from './store';

export default function OrderPaymentsPanel({ orderId, materialAmount = 0, deliveryAmount = 0 }: { orderId: string; materialAmount?: number; deliveryAmount?: number }) {
  const { role, token } = useAuthStore();
  const staff = role === 'admin' || role === 'logist';
  const [data, setData] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [material, setMaterial] = useState(String(materialAmount));
  const [delivery, setDelivery] = useState(String(deliveryAmount));
  const load = useCallback(async () => {
    try {
      const [next, cfg] = await Promise.all([commerceApi(`/orders/${orderId}/payments`), commerceApi('/payments/config')]);
      setData(next); setConfig(cfg); setError('');
    } catch (e: any) { setError(e.message); }
  }, [orderId, token]);
  const refresh = useCallback(async () => {
    try {
      const state = await commerceApi(`/orders/${orderId}/payments`);
      if (state.items[0] && ['creating', 'unknown', 'pending'].includes(state.items[0].status)) await commerceApi(`/payments/${state.items[0].id}/refresh`, { method: 'POST' });
      await load();
    } catch (e: any) { setError(e.message); }
  }, [load, orderId]);
  useEffect(() => { if (token) void load(); }, [load, token]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', onVisible); document.addEventListener('visibilitychange', onVisible);
    let destroyed = false;
    const handles: any[] = [];
    if (Capacitor.isNativePlatform()) {
      void App.addListener('appStateChange', s => { if (s.isActive) void refresh(); }).then(h => { if (destroyed) void h.remove(); else handles.push(h); });
      void Browser.addListener('browserFinished', () => { void refresh(); }).then(h => { if (destroyed) void h.remove(); else handles.push(h); });
    }
    return () => { destroyed = true; handles.forEach(h => { void h.remove(); }); window.removeEventListener('focus', onVisible); document.removeEventListener('visibilitychange', onVisible); };
  }, [refresh]);
  useEffect(() => {
    if (!data?.items?.some((p: any) => ['creating', 'unknown', 'pending'].includes(p.status))) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15000);
    return () => clearInterval(timer);
  }, [data, refresh]);
  if (!token || !['client', 'admin', 'logist'].includes(role || '')) return null;
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } };
  const pay = () => run(async () => {
    const result = await commerceApi(`/orders/${orderId}/payments`, { method: 'POST', body: JSON.stringify({ email: email || null }) });
    await load();
    if (result.confirmation_url) {
      const url = new URL(result.confirmation_url);
      if (url.protocol !== 'https:') throw new Error('Некорректная ссылка оплаты');
      if (Capacitor.isNativePlatform()) await Browser.open({ url: url.href, toolbarColor: '#2DB0E6' });
      else window.location.assign(url.href);
    } else if (result.status === 'succeeded') toast.success('Заказ уже оплачен');
    else if (result.status === 'failed') toast.error('Не удалось подготовить оплату. Обратитесь в поддержку.');
    else toast('Уточняем результат. Повторное списание не создаётся.');
  });
  const latest = data?.items?.[0];
  return <section className="mt-4 rounded-2xl border border-sky-100 bg-sky-50/60 p-4">
    <div className="flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-sm font-bold text-slate-800"><CreditCard className="h-5 w-5 text-sky-500" />Оплата заказа</h3><button disabled={busy} aria-label="Обновить оплату" className="rounded-lg p-2 text-sky-600" onClick={() => run(refresh)}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /></button></div>
    {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : !data ? <p className="mt-2 text-xs text-slate-400">Загрузка…</p> : <>
      <p className="mt-2 text-sm font-bold text-slate-700">{latest ? (latest.refund_status ? refundLabels[latest.refund_status] : paymentLabels[latest.status]) : data.quote ? 'Ожидает оплаты' : 'Стоимость уточняется'}</p>
      {data.quote && <p className="mt-1 text-lg font-extrabold text-sky-600">{rubles(data.quote.amount)} <span className="text-xs font-normal text-slate-500">включая доставку</span></p>}
      {!config?.enabled && <p className="mt-2 text-xs text-slate-500">Онлайн-оплата готовится к подключению.</p>}
      {(latest?.needs_review || data.requires_refund_review) && <p className="mt-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">{staff ? 'Требуется проверка платежа или решение по возврату.' : 'Сотрудник проверяет оплату и состояние заказа.'}</p>}
      {!staff && data.can_pay && <div className="mt-3 space-y-2">{config?.receipts_enabled && <label className="block text-xs text-slate-500">Электронная почта для чека<input aria-label="Почта для чека" type="email" maxLength={255} className={`${inputClass} mt-1 bg-white`} value={email} onChange={e => setEmail(e.target.value)} placeholder="mail@example.com" /></label>}<button disabled={busy} className={`${buttonClass} w-full`} onClick={pay}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}{latest?.status === 'pending' ? 'Продолжить оплату' : 'Оплатить заказ'}</button></div>}
      {staff && (!latest || ['failed', 'canceled'].includes(latest.status)) && <button className="mt-3 text-sm font-bold text-sky-600" onClick={() => { setMaterial(String(materialAmount)); setDelivery(String(deliveryAmount)); setQuoteOpen(!quoteOpen); }}>Подтвердить стоимость для оплаты</button>}
      {quoteOpen && <form className="mt-3 space-y-3" onSubmit={e => { e.preventDefault(); void run(async () => {
        const cents = (value: string) => { const [whole, decimal = ''] = value.split('.'); return Number(whole) * 100 + Number(decimal.padEnd(2, '0')); };
        await commerceApi(`/orders/${orderId}/payment-quote`, { method: 'POST', body: JSON.stringify({ amount: ((cents(material) + cents(delivery)) / 100).toFixed(2), material_amount: material, delivery_amount: delivery }) });
        setQuoteOpen(false); await load(); toast.success('Стоимость подтверждена');
      }); }}><label className="block text-xs text-slate-500">Материал, ₽<input required type="number" min="0" max="99999999999" step="0.01" className={`${inputClass} mt-1`} value={material} onChange={e => setMaterial(e.target.value)} /></label><label className="block text-xs text-slate-500">Доставка, ₽<input required type="number" min="0" max="99999999999" step="0.01" className={`${inputClass} mt-1`} value={delivery} onChange={e => setDelivery(e.target.value)} /></label><p className="text-sm">Итого: {rubles(Number(material) + Number(delivery))}</p><button disabled={busy} className={`${buttonClass} w-full`}>Подтвердить сумму</button></form>}
      {!!data.items.length && <button className="mt-3 flex items-center gap-2 text-xs font-bold text-slate-500" onClick={() => setExpanded(!expanded)}><History className="h-4 w-4" />История платежей</button>}
      {expanded && <div className="mt-3 space-y-2">{data.items.map((p: any) => <button key={p.id} className="w-full rounded-xl bg-white p-3 text-left text-xs text-slate-500" onClick={() => run(async () => setHistory(await commerceApi(`/payments/${p.id}`)))}>{dateTime(p.created_at)} · {rubles(p.amount)}<span className="mt-1 block font-bold">{paymentLabels[p.status]}{p.refund_status && ` · ${refundLabels[p.refund_status]}`}</span></button>)}{history && <div className="rounded-xl bg-white p-3 text-xs text-slate-500">{history.events.map((e: any, i: number) => <p key={i} className="mb-2">{dateTime(e.created_at)} · {e.description}</p>)}<p>Чек: {history.receipt_status || '—'}</p>{history.settlement_receipt_status && <p>Чек зачёта: {history.settlement_receipt_status}</p>}</div>}</div>}
    </>}
  </section>;
}
