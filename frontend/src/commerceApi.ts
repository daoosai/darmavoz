import { useAuthStore } from './store';
import { baseURL } from './utils';

export async function commerceApi(path: string, options: RequestInit = {}) {
  const response = await fetch(`${baseURL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${useAuthStore.getState().token}`, ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : 'Не удалось выполнить запрос');
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
export const refundLabels: Record<string, string> = { creating: 'Подготовка возврата', unknown: 'Проверяем возврат', pending: 'Возврат обрабатывается', succeeded: 'Возвращено', canceled: 'Возврат отменён', failed: 'Ошибка возврата' };
export const inputClass = 'w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100';
export const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-sky-600 disabled:opacity-50';
