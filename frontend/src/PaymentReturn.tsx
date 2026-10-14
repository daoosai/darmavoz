import { useCallback, useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { CheckCircle, CircleX, Loader2 } from 'lucide-react';
import CommerceShell from './CommerceShell';
import { buttonClass, commerceApi, shortOrder } from './commerceApi';
import { useAuthStore, useClientOrdersStore } from './store';
import { toClientOrderPaymentState } from './utils/statusMapper';

const PAYMENT_POLL_MS = 2500;
const SUCCESS_REDIRECT_MS = 2500;
const pendingStatuses = new Set(['pending', 'waiting_for_capture', 'waiting_for_payment', 'creating', 'unknown']);

function orderFromUrl(url: string) {
  try {
    const id = new URL(url).searchParams.get('payment_order');
    return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
  } catch { return null; }
}

export default function PaymentReturn({ onOpenOrder }: { onOpenOrder: (orderId: string) => void }) {
  const [orderId, setOrderId] = useState(() => orderFromUrl(window.location.href));
  const [result, setResult] = useState<{ orderId: string; status: string } | null>(null);
  const [error, setError] = useState('');
  const role = useAuthStore(s => s.role);
  const token = useAuthStore(s => s.token);
  const setOrderPaymentState = useClientOrdersStore(s => s.setOrderPaymentState);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let alive = true;
    const handle = App.addListener('appUrlOpen', ({ url }) => {
      const order = orderFromUrl(url);
      if (alive && order) { setOrderId(order); void Browser.close().catch(() => {}); }
    });
    void App.getLaunchUrl().then(result => {
      const order = result && orderFromUrl(result.url);
      if (alive && order) setOrderId(order);
    });
    return () => { alive = false; void handle.then(h => h.remove()); };
  }, []);

  useEffect(() => {
    setResult(null);
    setError('');
    if (!orderId || !token || role !== 'client') return;
    let alive = true;
    let timer: number | undefined;
    const controller = new AbortController();
    const load = async () => {
      try {
        const data = await commerceApi(`/orders/${orderId}/payments`, { signal: controller.signal });
        if (!alive) return;
        const payment = toClientOrderPaymentState(data);
        const status = payment.status || 'pending';
        setResult({ orderId, status });
        setOrderPaymentState(orderId, payment);
        setError('');
        if (pendingStatuses.has(status)) timer = window.setTimeout(load, PAYMENT_POLL_MS);
      } catch (e) {
        if (!alive) return;
        const status = (e as { status?: number }).status;
        if (status === 401 || status === 403 || status === 404) {
          setResult({ orderId, status: 'unavailable' });
          setError(status === 404 ? 'Заказ не найден.' : 'Войдите в аккаунт, из которого оформлен заказ.');
          return;
        }
        setError('Не удалось обновить статус. Повторяем проверку…');
        timer = window.setTimeout(load, PAYMENT_POLL_MS);
      }
    };
    void load();
    return () => { alive = false; window.clearTimeout(timer); controller.abort(); };
  }, [orderId, role, token, setOrderPaymentState]);

  const status = result?.orderId === orderId ? result.status : null;
  const succeeded = status === 'succeeded';
  const waiting = status === null || pendingStatuses.has(status);
  const authenticated = !!token && role === 'client';
  const close = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('payment_order');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    setOrderId(null);
    if (orderId && role === 'client' && token) onOpenOrder(orderId);
  }, [orderId, role, token, onOpenOrder]);

  useEffect(() => {
    if (!succeeded || !authenticated) return;
    const timer = window.setTimeout(close, SUCCESS_REDIRECT_MS);
    return () => window.clearTimeout(timer);
  }, [succeeded, authenticated, close]);

  if (!orderId) return null;
  return <CommerceShell title="Результат оплаты" subtitle={`Заказ ${shortOrder(orderId)}`} onClose={close}>
    <div role="status" aria-live="polite" className="rounded-3xl bg-white p-6 text-center shadow-sm">
      {authenticated ? <>
        {succeeded ? <CheckCircle aria-label="Оплата успешна" className="mx-auto h-20 w-20 text-green-500" />
          : waiting ? <Loader2 aria-label="Ожидаем подтверждения" className="mx-auto h-16 w-16 animate-spin text-sky-500" />
          : <CircleX className="mx-auto h-16 w-16 text-slate-400" />}
        <h2 className="mt-4 text-xl font-bold">{succeeded ? 'Оплата прошла успешно!' : waiting ? 'Ожидаем подтверждения от банка' : status === 'unavailable' ? 'Результат пока недоступен' : 'Оплата не завершена'}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">{succeeded ? 'Сейчас вы будете перенаправлены к заказу...' : waiting ? 'Пожалуйста, подождите несколько секунд...' : status === 'unavailable' ? 'Проверьте доступ к заказу.' : 'Вернитесь к заказу, чтобы посмотреть подробности оплаты.'}</p>
        {error && <p className="mt-3 text-sm text-slate-500">{error}</p>}
      </> : <p className="text-sm text-slate-500">Для просмотра результата войдите в аккаунт, из которого оформлен заказ.</p>}
    </div>
    {!Capacitor.isNativePlatform() && !succeeded && <a className={`${buttonClass} w-full`} href={`${import.meta.env.VITE_PAYMENT_APP_SCHEME || 'darmavoz'}://payment?payment_order=${orderId}`}>Вернуться в приложение</a>}
    <button className="w-full rounded-xl bg-white p-3 text-sm font-bold text-slate-600" onClick={close}>Вернуться к заказу</button>
  </CommerceShell>;
}
