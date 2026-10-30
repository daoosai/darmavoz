import { useAuthStore } from './store';
import { baseURL } from './utils';

export async function commerceApi(path: string, options: RequestInit = {}) {
  const response = await fetch(`${baseURL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${useAuthStore.getState().token}`, ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(typeof body.detail === 'string' ? body.detail : body.detail?.message || 'Не удалось выполнить запрос');
    Object.assign(error, { status: response.status, code: typeof body.code === 'string' ? body.code : typeof body.detail?.code === 'string' ? body.detail.code : undefined });
    throw error;
  }
  return response.json();
}

export const rubles = (value: string | number) => Number(value).toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' });
export const shortOrder = (id: string) => `#${id.slice(-6).toUpperCase()}`;
export const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString('ru-RU') : '—';
export const paymentLabels: Record<string, string> = {
  creating: 'Подготовка оплаты', unknown: 'Проверяем оплату', pending: 'Ожидает оплаты', succeeded: 'Оплачено',
  canceled: 'Отменено / отклонено', failed: 'Ошибка', refunded: 'Возвращено',
};
export const refundLabels: Record<string, string> = { queued: 'Возврат в очереди', partial: 'Частично возвращено', manual_review: 'Возврат требует сверки', creating: 'Подготовка возврата', unknown: 'Проверяем возврат', pending: 'Возврат обрабатывается', succeeded: 'Возвращено', canceled: 'Возврат отменён', failed: 'Ошибка возврата' };
export const inputClass = 'w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100';
export const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-sky-600 disabled:opacity-50';


export const subscriptionPaymentLabel = (status: string, reason?: string | null) =>
  status === 'canceled' && reason?.startsWith('provider_') ? 'Оплата отклонена банком или платёжным сервисом' : paymentLabels[status] || (status === 'queued' ? 'В очереди' : 'Требуется сверка');
export const subscriptionFailureReason = (reason?: string | null) => {
  const labels: Record<string, string> = { provider_insufficient_funds: 'Недостаточно средств', provider_card_expired: 'Истёк срок действия карты', provider_invalid_csc: 'Неверный защитный код карты', 'provider_3d_secure_failed': 'Не пройдена проверка банка', provider_payment_method_limit_exceeded: 'Превышен лимит оплаты', provider_issuer_unavailable: 'Банк временно недоступен' };
  return reason?.startsWith('provider_') ? labels[reason] || 'Платёжный сервис отклонил оплату. Попробуйте другой способ.' : '';
};
