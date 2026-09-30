import { useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { CreditCard } from 'lucide-react';
import CommerceShell from './CommerceShell';
import OrderPaymentsPanel from './OrderPaymentsPanel';
import { buttonClass, shortOrder } from './commerceApi';
import { useAuthStore } from './store';

function orderFromUrl(url: string) {
  try {
    const id = new URL(url).searchParams.get('payment_order');
    return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
  } catch { return null; }
}

export default function PaymentReturn() {
  const [orderId, setOrderId] = useState(() => orderFromUrl(window.location.href));
  const role = useAuthStore(s => s.role);
  const token = useAuthStore(s => s.token);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let alive = true;
    const handle = App.addListener('appUrlOpen', ({ url }) => {
      const order = orderFromUrl(url); if (order) { setOrderId(order); void Browser.close().catch(() => {}); }
    });
    void App.getLaunchUrl().then(result => { if (alive && result) setOrderId(orderFromUrl(result.url)); });
    return () => { alive = false; void handle.then(h => h.remove()); };
  }, []);
  if (!orderId) return null;
  const close = () => {
    const url = new URL(window.location.href); url.searchParams.delete('payment_order'); window.history.replaceState({}, '', url.pathname + url.search + url.hash); setOrderId(null);
  };
  return <CommerceShell title="Результат оплаты" subtitle={`Заказ ${shortOrder(orderId)}`} onClose={close}>
    <div className="rounded-3xl bg-white p-6 text-center shadow-sm"><CreditCard className="mx-auto h-12 w-12 text-sky-400" /><h2 className="mt-4 text-xl font-bold">Проверяем оплату заказа</h2><p className="mt-2 text-sm leading-relaxed text-slate-500">Результат подтверждается платёжным сервисом. Если статус ещё не обновился, подождите и обновите его.</p></div>
    {token && role === 'client' ? <OrderPaymentsPanel orderId={orderId} /> : <p className="rounded-2xl bg-white p-4 text-sm text-slate-500">Для просмотра результата войдите в аккаунт, из которого оформлен заказ.</p>}
    {!Capacitor.isNativePlatform() && <a className={`${buttonClass} w-full`} href={`${import.meta.env.VITE_PAYMENT_APP_SCHEME || 'darmavoz'}://payment?payment_order=${orderId}`}>Вернуться в приложение</a>}
    <button className="w-full rounded-xl bg-white p-3 text-sm font-bold text-slate-600" onClick={close}>Вернуться к заказам</button>
  </CommerceShell>;
}
