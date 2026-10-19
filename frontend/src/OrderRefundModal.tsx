import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { buttonClass, commerceApi, inputClass, rubles, shortOrder } from './commerceApi';
import { useAuthStore } from './store';

type Payment = { id: string; status: string; refundable_amount: string; refund_status?: string };
const pendingRefund = ['queued', 'creating', 'unknown', 'pending', 'manual_review'];

export default function OrderRefundModal({ orderId, onClose, onQueued }: {
  orderId: string; onClose: () => void; onQueued: () => void;
}) {
  const role = useAuthStore(state => state.role);
  const dialog = useRef<HTMLDialogElement>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentId, setPaymentId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const staff = role === 'admin' || role === 'logist';
  useEffect(() => {
    if (!staff) return;
    dialog.current?.showModal();
    let active = true;
    void commerceApi('/orders/' + orderId + '/payments').then(data => {
      if (!active) return;
      const eligible = data.items.filter((p: Payment) => p.status === 'succeeded'
        && Number(p.refundable_amount) > 0 && !pendingRefund.includes(p.refund_status || ''));
      setPayments(eligible);
      setPaymentId(eligible[0]?.id || '');
      setAmount(eligible[0]?.refundable_amount || '');
    }).catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [orderId, staff]);
  if (!staff) return null;
  const payment = payments.find(p => p.id === paymentId);
  const submit = async () => {
    if (submitting.current || !payment) return;
    if (reason.trim().length < 3) { setError('Укажите причину возврата (не менее 3 символов).'); return; }
    submitting.current = true; setBusy(true); setError('');
    try {
      await commerceApi('/payments/' + payment.id + '/refund', { method: 'POST',
        body: JSON.stringify({ amount, reason: reason.trim(), request_id: requestId }) });
    } catch (e: any) {
      // Keep request_id and entered values for a safe retry after a network failure.
      setError(e.message); submitting.current = false; setBusy(false); return;
    }
    toast.success('Возврат поставлен в очередь');
    onClose(); onQueued();
  };
  return createPortal(<dialog ref={dialog} aria-labelledby="order-refund-title"
    onCancel={e => { e.preventDefault(); if (!submitting.current) onClose(); }}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl bg-white p-5 text-slate-900 shadow-xl backdrop:bg-black/40">
    <h2 id="order-refund-title" className="text-xl font-bold">Оформить возврат</h2>
    <p className="mt-1 text-sm text-slate-500">Заказ {shortOrder(orderId)}</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
    {loading ? <p className="mt-4">Загрузка платежей…</p> : !payment ?
      <p className="mt-4 text-sm">Нет доступного платежа для возврата. Обновите заказ и проверьте историю платежей.</p> :
      <form className="mt-4 space-y-4" onSubmit={e => { e.preventDefault(); void submit(); }}>
        {payments.length > 1 && <label className="block text-sm">Платёж<select aria-label="Платёж для возврата" disabled={busy} className={inputClass} value={paymentId} onChange={e => {
          setPaymentId(e.target.value); setAmount(payments.find(p => p.id === e.target.value)!.refundable_amount); setRequestId(crypto.randomUUID());
        }}>{payments.map(p => <option key={p.id} value={p.id}>{shortOrder(p.id)} · {rubles(p.refundable_amount)}</option>)}</select></label>}
        <p className="text-sm font-bold text-amber-900">Доступно к возврату: {rubles(payment.refundable_amount)}</p>
        <label className="block text-sm">Сумма возврата, ₽<input autoFocus required aria-label="Сумма возврата" type="number" min="0.01" max={payment.refundable_amount} step="0.01" disabled={busy} className={inputClass} value={amount} onChange={e => { setAmount(e.target.value); setRequestId(crypto.randomUUID()); }} /></label>
        <label className="block text-sm">Причина возврата<textarea required minLength={3} maxLength={2000} aria-label="Причина возврата" placeholder="Причина возврата" disabled={busy} className={inputClass} value={reason} onChange={e => { setReason(e.target.value); setRequestId(crypto.randomUUID()); }} /></label>
        <label className="flex items-center gap-2 text-sm"><input required type="checkbox" disabled={busy} />Подтверждаю возврат указанной суммы</label>
        <button disabled={busy} className={buttonClass}>Подтвердить возврат</button>
      </form>}
    <button type="button" disabled={busy} className="mt-4 min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold disabled:opacity-50" onClick={onClose}>Закрыть</button>
  </dialog>, document.body);
}
