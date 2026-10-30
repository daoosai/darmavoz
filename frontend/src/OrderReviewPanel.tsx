import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Star } from 'lucide-react';
import { buttonClass, commerceApi, dateTime, inputClass } from './commerceApi';
interface Review { can_receive: boolean; received_at: string | null; rating: number | null; comment: string | null }
export default function OrderReviewPanel({ orderId, status }: { orderId: string; status: string }) {
  const [data, setData] = useState<Review | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [rating, setRating] = useState(0), [comment, setComment] = useState('');
  const visible = ['delivered', 'completed'].includes(status);
  const load = useCallback(async () => { const next = await commerceApi(`/client/orders/${orderId}/review`); setData(next); setError(''); }, [orderId]);
  useEffect(() => { if (visible) void load().catch(e => setError(e.message)); }, [visible, load]);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить'); } finally { setBusy(false); } };
  if (!visible) return null;
  return <section aria-label="Получение и отзыв" className="mt-3 space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
    <h3 className="text-sm font-bold text-slate-800">Получение и отзыв</h3>
    {error && <p role="alert" className="text-xs text-red-600">{error} <button className="min-h-11 font-bold text-sky-600" disabled={busy} onClick={() => void run(load)}>Повторить</button></p>}
    {!data && !error && <p className="text-xs text-slate-500">Загрузка…</p>}
    {data && !data.received_at && <><p className="text-xs text-slate-500">Подтвердите, что товар получен. После этого можно оставить отзыв.</p><button disabled={busy} className={`${buttonClass} w-full`} onClick={() => void run(() => commerceApi(`/client/orders/${orderId}/received`, { method: 'POST' }))}>Подтвердить получение</button></>}
    {data?.received_at && <p className="flex items-start gap-2 text-xs text-emerald-700"><CheckCircle2 className="h-4 w-4 shrink-0" />Получение подтверждено {dateTime(data.received_at)}</p>}
    {data?.rating && <div><p className="text-sm font-bold text-slate-700">Ваша оценка: {data.rating} из 5</p>{data.comment && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">{data.comment}</p>}</div>}
    {data?.received_at && !data.rating && <form className="space-y-3" onSubmit={e => { e.preventDefault(); void run(() => commerceApi(`/client/orders/${orderId}/review`, { method: 'POST', body: JSON.stringify({ rating, comment: comment.trim() || null }) })); }}><fieldset><legend className="text-xs text-slate-500">Оцените доставку</legend><div className="mt-1 flex flex-wrap gap-1">{[1, 2, 3, 4, 5].map(value => <button key={value} type="button" aria-label={`Оценка ${value}`} aria-pressed={rating === value} className="grid h-11 w-11 place-items-center rounded-xl hover:bg-amber-50" onClick={() => setRating(value)}><Star className={`h-6 w-6 ${value <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} /></button>)}</div></fieldset><textarea aria-label="Текст отзыва" maxLength={2000} rows={3} className={inputClass} placeholder="Комментарий (необязательно)" value={comment} onChange={e => setComment(e.target.value)} /><button className={`${buttonClass} w-full`} disabled={busy || !rating}>Отправить отзыв</button></form>}
  </section>;
}
