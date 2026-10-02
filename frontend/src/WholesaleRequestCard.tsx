import type { ReactNode } from 'react';
import { CalendarDays, Copy, MapPin, Phone, Truck, UserRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { buttonClass, rubles } from './commerceApi';
import { formatPhoneNumber, formatShortAddress } from './utils';

export interface WholesaleCardData {
  material_name: string; volume: string | number; unit: string;
  vehicle_count?: string | number | null; pickup_address: string; delivery_address: string;
  starts_on: string; ends_on: string; price: string | number; price_basis: string;
  contact_name: string; contact_phone: string; comment?: string | null;
  is_owner?: boolean; status?: string; reject_reason?: string | null;
}
export const wholesaleStates: Record<string, string> = { pending: 'На модерации', approved: 'Опубликовано', rejected: 'Отклонено', archived: 'В архиве' };
const units: Record<string, string> = { m3: 'м³', t: 'т', vehicle: 'машину', total: 'весь объём' };
function readableDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || 'Не указано';
  return new Date(value + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}
export default function WholesaleRequestCard({ request, onOpen, headerAction, footer, contactActions = true }: {
  request: WholesaleCardData; onOpen?: () => void; headerAction?: ReactNode; footer?: ReactNode; contactActions?: boolean;
}) {
  const count = Number(request.vehicle_count);
  const title = <><h3 className="break-words text-xl font-extrabold tracking-tight">{request.material_name || 'Материал'}</h3>
    <p className="mt-1 text-lg font-bold text-slate-600">{Number(request.volume || 0).toLocaleString('ru-RU')} {units[request.unit]}</p></>;
  return <article data-testid="wholesale-request-card" className="space-y-5 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        {request.status && <span className={`mb-3 inline-block rounded-full px-3 py-1 text-xs font-bold ${request.status === 'rejected' ? 'bg-red-50 text-red-700' : request.status === 'approved' ? 'bg-green-50 text-green-700' : 'bg-sky-50 text-sky-600'}`}>{wholesaleStates[request.status]}</span>}
        {onOpen ? <button type="button" className="w-full text-left" onClick={onOpen}>{title}</button> : title}
      </div>
      {headerAction}
    </div>
    <dl className="space-y-4 rounded-2xl bg-slate-50 p-4 text-sm">
      <div className="flex gap-3"><MapPin className="mt-0.5 h-5 w-5 shrink-0 text-sky-500" /><div className="min-w-0"><dt className="mb-1 text-xs font-bold text-slate-500">Маршрут</dt><dd className="break-words leading-relaxed">{formatShortAddress(request.pickup_address) || 'Место загрузки'} <span className="text-sky-500">➔</span> {formatShortAddress(request.delivery_address) || 'Место доставки'}</dd></div></div>
      <div className="flex gap-3"><CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-sky-500" /><div><dt className="mb-1 text-xs font-bold text-slate-500">Сроки</dt><dd>{readableDate(request.starts_on)}{request.ends_on !== request.starts_on && ` — ${readableDate(request.ends_on)}`}</dd></div></div>
      {count > 0 && <div className="flex gap-3"><Truck className="h-5 w-5 shrink-0 text-sky-500" /><div><dt className="sr-only">Машины</dt><dd>Нужно машин: {count.toLocaleString('ru-RU')}</dd></div></div>}
    </dl>
    <div className="rounded-2xl bg-sky-50 px-4 py-3"><p className="text-xs font-bold text-sky-700">Предлагаемая ставка</p><p className="mt-1 text-xl font-extrabold text-sky-600">{rubles(String(request.price || 0))} <span className="text-sm font-semibold">/ {units[request.price_basis]}</span></p></div>
    {request.comment && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-600">{request.comment}</p>}
    {request.reject_reason && <p className="whitespace-pre-wrap rounded-xl bg-red-50 p-3 text-sm text-red-700">Причина отклонения: <span>{request.reject_reason}</span></p>}
    <div className="border-t border-slate-100 pt-4">
      <div className="flex gap-3"><UserRound className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" /><div className="min-w-0"><p className="break-words font-bold">{request.contact_name || 'Контактное лицо'}</p><p className="mt-1 text-sm text-slate-500">{formatPhoneNumber(request.contact_phone) || 'Телефон не указан'}</p></div></div>
      {contactActions && !request.is_owner && request.contact_phone && <div className="mt-3 flex gap-2"><a className={`${buttonClass} flex-1`} href={`tel:${request.contact_phone.replace(/[^+\d]/g, '')}`}><Phone className="h-4 w-4" />Позвонить</a><button type="button" aria-label="Скопировать номер" className="rounded-xl bg-slate-100 p-3" onClick={() => navigator.clipboard.writeText(request.contact_phone).then(() => toast.success('Номер скопирован')).catch(() => toast.error('Не удалось скопировать номер'))}><Copy className="h-5 w-5" /></button></div>}
    </div>
    {(onOpen || footer) && <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-4">
    {onOpen && <button type="button" className="text-sm font-bold text-sky-600" onClick={onOpen}>Подробнее о заявке</button>}
    {footer && <div className="flex shrink-0 items-center">{footer}</div>}
    </div>}
  </article>;
}
