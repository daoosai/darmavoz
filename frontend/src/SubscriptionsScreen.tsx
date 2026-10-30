import { useCallback, useEffect, useRef, useState } from 'react';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import CommerceShell from './CommerceShell';
import { trackJourney } from './journey';
import { buttonClass, commerceApi, dateTime, inputClass, paymentLabels, subscriptionPaymentLabel, subscriptionFailureReason, rubles } from './commerceApi';
interface Access { active: boolean; kind: string; ends_at: string | null; reason: string | null }
interface Category extends Access { category: string; label: string }
interface Vehicle { id: string; plate_number: string; title: string; driver: Access; carrier: Access }
interface Account { enabled: boolean; categories: Category[]; vehicles: Vehicle[]; can_chat: boolean }
interface Plan { id: string; category: string; name: string; months: number; amount: string; test_only: boolean }
interface Payment { id: string; request_id: string; category: string; months: number; amount: string; status: string; last_error?: string | null; created_at: string; confirmation_url: string | null; refunded_amount: string; refunds: { id: string; status: string; amount: string; access_review_required: boolean }[] }
const labels: Record<string, string> = { trial: 'Пробный период', granted: 'Доступ активен', not_started: 'Пробный период не использован', expired: 'Срок доступа истёк', restricted: 'Требуется подписка для машины' };
export default function SubscriptionsScreen({ onClose }: { onClose: () => void }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<{ plan: string; id: string } | null>(null);
  const load = useCallback(async () => {
    const [a, p, history] = await Promise.all([commerceApi('/subscriptions/me'), commerceApi('/subscriptions/plans'), commerceApi('/subscriptions/payments')]);
    setAccount(a); setPlans(p); setPayments(history); setError('');
    // Keep one request while its result is uncertain; a completed purchase can be renewed.
    if (request.current && history.some((payment: Payment) => payment.request_id === request.current?.id && ['succeeded', 'canceled', 'failed'].includes(payment.status))) request.current = null;
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = () => { if (active) void load().catch(e => active && setError(e.message)); };
    refresh(); const timer = window.setInterval(refresh, 5000);
    const appListener = App.addListener('appStateChange', state => { if (state.isActive) refresh(); });
    const browserListener = Browser.addListener('browserFinished', refresh);
    window.addEventListener('online', refresh); window.addEventListener('focus', refresh);
    return () => { active = false; void appListener.then(h => h.remove()); void browserListener.then(h => h.remove()); window.clearInterval(timer); window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh); };
  }, [load]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось выполнить действие'); }
    finally { setBusy(false); }
  };
  const pay = (plan: Plan) => run(async () => {
    if (request.current?.plan !== plan.id) { request.current = { plan: plan.id, id: crypto.randomUUID() }; trackJourney('subscription', 'subscription_plan_selected', { screen: 'subscriptions' }, true); }
    await commerceApi('/subscriptions/payments', { method: 'POST', body: JSON.stringify({ plan_id: plan.id, request_id: request.current.id, email: email || null }) });
  });
  const openPayment = (url: string) => run(async () => {
    const target = new URL(url); if (target.protocol !== 'https:') throw new Error('Некорректная ссылка оплаты');
    if (Capacitor.isNativePlatform()) await Browser.open({ url: target.href, toolbarColor: '#2DB0E6' });
    else window.location.assign(target.href);
  });
  return <CommerceShell title="Подписки" subtitle="Доступ к возможностям вашей категории" onClose={onClose}>
    <p className="rounded-2xl bg-sky-50 p-4 text-sm text-sky-900">Через приложение оплачиваются только подписки. За материалы и доставку покупатель рассчитывается напрямую с водителем.</p>
    {error && <div role="alert" className="space-y-3 rounded-2xl bg-red-50 p-4 text-sm text-red-700"><p>{error}</p><button className={buttonClass} disabled={busy} onClick={() => void run(load)}>Повторить</button></div>}
    {!account && !error && <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Загрузка подписок…</p>}
    {account && !account.enabled && <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">Подписки пока не включены в этом контуре.</p>}
    {account?.enabled && <>
      {account.categories.length === 0 && <p className="rounded-2xl bg-white p-4 text-sm text-slate-600">Подписка оформляется при подключении профессиональной категории. Карта и общедоступные возможности доступны без подписки.</p>}
      {account.categories.map(category => <section key={category.category} className="min-w-0 space-y-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3"><ShieldCheck className={`mt-0.5 h-5 w-5 shrink-0 ${category.active ? 'text-emerald-500' : 'text-slate-400'}`} /><div className="min-w-0"><h2 className="font-bold">{category.label}</h2><p className={`mt-1 text-sm ${category.active ? 'text-emerald-700' : 'text-slate-500'}`}>{labels[category.kind] || 'Требуется подписка'}</p>{category.ends_at && <p className="mt-1 text-xs text-slate-500">До {dateTime(category.ends_at)}</p>}</div></div>
        {category.kind === 'not_started' && <button disabled={busy} className={`${buttonClass} w-full`} onClick={() => void run(() => commerceApi('/subscriptions/trial', { method: 'POST', body: JSON.stringify({ category: category.category }) }))}>Активировать бесплатные 14 дней</button>}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{plans.filter(p => p.category === category.category).map(plan => <button key={plan.id} disabled={busy} className="min-w-0 rounded-xl border border-slate-200 p-3 text-left hover:border-sky-400 disabled:opacity-50" onClick={() => void pay(plan)}><span className="block text-sm font-bold">{plan.months} мес. · {rubles(plan.amount)}</span><span className="mt-1 block text-xs text-slate-500">{plan.test_only ? 'Тестовый тариф ЮKassa' : plan.name}</span></button>)}</div>
        {!plans.some(p => p.category === category.category) && <p className="text-xs text-slate-500">Опубликованных тарифов пока нет. Неутверждённые тарифы недоступны для оплаты.</p>}
      </section>)}
      {plans.length > 0 && <label className="block text-sm font-semibold">Почта для чека<input type="email" autoComplete="email" className={`${inputClass} mt-2`} value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.ru" /></label>}
      {account.vehicles.length > 0 && <section className="space-y-3 rounded-2xl bg-white p-4"><h2 className="font-bold">Машины и пробный доступ</h2><p className="text-xs text-slate-500">История пробного периода сохраняется по госномеру. Смена телефона не начинает срок заново.</p>{account.vehicles.map(v => <div key={v.id} className="min-w-0 space-y-2 rounded-xl border border-slate-100 p-3"><p className="break-words text-sm font-bold">{v.plate_number} · {v.title}</p>{(['driver', 'carrier'] as const).map(c => <div key={c}><p className="text-xs text-slate-500">{c === 'driver' ? 'Водитель' : 'Перевозчик'}: {v[c].active ? `доступ до ${dateTime(v[c].ends_at)}` : 'нет доступа'}</p>{!v[c].active && account.categories.some(x => x.category === c && x.kind === 'trial') && <button disabled={busy} className="mt-2 min-h-11 text-sm font-bold text-sky-600" onClick={() => void run(() => commerceApi('/subscriptions/trial/vehicles', { method: 'POST', body: JSON.stringify({ category: c, vehicle_id: v.id }) }))}>Проверить пробный доступ машины</button>}</div>)}</div>)}</section>}
    </>}
    {payments.length > 0 && <section className="space-y-3"><h2 className="font-bold">История оплат подписок</h2>{payments.map(p => <article key={p.id} className="min-w-0 space-y-2 rounded-2xl bg-white p-4"><p className="text-sm font-bold">{rubles(p.amount)} · {p.months} мес.</p><p className="text-xs text-slate-500">{dateTime(p.created_at)}</p><p className="text-sm">{p.status === 'queued' ? 'Готовим ссылку оплаты…' : subscriptionPaymentLabel(p.status, p.last_error)}</p>{subscriptionFailureReason(p.last_error) && <p className="text-sm text-amber-700">{subscriptionFailureReason(p.last_error)}</p>}{p.confirmation_url && <button disabled={busy} className={buttonClass} onClick={() => void openPayment(p.confirmation_url!)}>Перейти к оплате</button>}{Number(p.refunded_amount) > 0 && <p className="text-sm text-amber-700">Возвращено: {rubles(p.refunded_amount)}</p>}{p.refunds.some(r => r.access_review_required) && <p className="text-xs text-amber-700">Возврат подтверждён. Решение по сроку доступа рассматривается администратором.</p>}</article>)}</section>}
    <button disabled={busy} className="flex min-h-11 items-center gap-2 text-sm font-bold text-sky-600" onClick={() => void run(load)}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Обновить статус</button>
  </CommerceShell>;
}
