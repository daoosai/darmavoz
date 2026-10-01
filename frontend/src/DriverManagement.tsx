import { useEffect, useState } from 'react';
import { baseURL } from './utils';
import { MapPin } from 'lucide-react';
import ServiceCitiesPanel from './ServiceCitiesPanel';
import { useOperatorCityStore } from './operatorCityStore';
export const driverReasonLabels: Record<string, string> = {
  city_missing: 'Город не назначен', driver_inactive: 'Аккаунт отключён', shift_off: 'Не на смене',
  status_offline: 'Недоступен', status_busy: 'Занят', auto_dispatch_disabled: 'Автораспределение выключено',
  dispatch_admission_denied: 'Нет допуска', vehicle_missing: 'Машина не привязана', vehicle_inactive: 'Машина отключена',
  category_missing: 'Категория требует проверки', volume_missing: 'Кубатура не указана',
};
export function DriverSummary({ driver, editable = false, onSaved }: { driver: any; editable?: boolean; onSaved?: () => void }) {
  const cities = useOperatorCityStore((state) => state.cities);
  const [open, setOpen] = useState(false);
  const names = (driver.city_ids || []).map((id: string) => cities.find((city) => city.id === id)?.name || id.slice(0, 8));
  return <div className="mt-2 space-y-2 text-xs">
    <p className="flex items-center gap-1 font-semibold text-sky-700"><MapPin className="h-3.5 w-3.5" />{names.join(', ') || 'Город не назначен'}</p>
    <p className="text-slate-500">{driver.is_on_shift ? 'На смене' : 'Не на смене'} · PUSH: {driver.has_push_token ? 'устройство подключено' : 'устройство не подключено'}</p>
    <p className="text-slate-500">Категория: {driver.vehicle?.transport_category?.title || driver.vehicle?.delivery_option?.transport_category?.title || (driver.effective_transport_category_id ? 'назначена' : 'требует проверки')}</p>
    {driver.current_order_id && <p className="font-semibold text-amber-700">Текущий заказ №{driver.current_order_id.slice(0, 8)}</p>}
    {driver.last_location_updated_at && <p className="text-slate-500">Геопозиция: {new Date(driver.last_location_updated_at).toLocaleString('ru-RU')}</p>}
    {(driver.dispatch_exclusion_reasons || []).length > 0 ? <p className="text-amber-700">{driver.dispatch_exclusion_reasons.map((reason: string) => driverReasonLabels[reason] || 'Требуется проверка модерации').join(' · ')}</p> : <p className="text-emerald-700">Доступен для подбора; геопозиция проверяется при распределении</p>}
    {editable && <><button type="button" onClick={() => setOpen(!open)} className="rounded-xl bg-sky-50 px-3 py-2 font-bold text-sky-700">Города обслуживания</button>{open && <ServiceCitiesPanel driverId={driver.id} onSaved={onSaved} />}</>}
  </div>;
}
export function DriverFilters({ value, onChange }: { value: Record<string, string>; onChange: (value: Record<string, string>) => void }) {
  const [categories, setCategories] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => { const controller = new AbortController(); fetch(baseURL + "/transport-categories", { signal: controller.signal }).then(async (response) => { if (response.ok) setCategories(await response.json()); }).catch(() => {}); return () => controller.abort(); }, []);
  const set = (key: string, next: string) => onChange({ ...value, [key]: next });
  return <div className="mb-3 grid gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm sm:grid-cols-3">
    <input aria-label="Поиск водителя" placeholder="Имя, телефон или госномер" value={value.q || ''} onChange={(event) => set('q', event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" />
    <select aria-label="Статус водителя" value={value.status || ''} onChange={(event) => set('status', event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><option value="">Все статусы</option><option value="available">Доступен</option><option value="busy">Занят</option><option value="offline">Недоступен</option></select>
    <select aria-label="Смена" value={value.is_on_shift || ''} onChange={(event) => set('is_on_shift', event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><option value="">Все смены</option><option value="true">На смене</option><option value="false">Не на смене</option></select>
    <select aria-label="Категория транспорта" value={value.transport_category_id || ""} onChange={(event) => set("transport_category_id", event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><option value="">Все категории</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}</select>
    <input aria-label="Кубатура" type="number" min="0.1" step="0.1" placeholder="Кубатура рейса, м³" value={value.volume || ''} onChange={(event) => set('volume', event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" />
    <select aria-label="Допуск" value={value.is_dispatch_eligible || ''} onChange={(event) => set('is_dispatch_eligible', event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><option value="">Любой допуск</option><option value="true">Допущен</option><option value="false">Без допуска</option></select>
    <select aria-label="Модерация" value={value.moderation_status || ''} onChange={(event) => set('moderation_status', event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><option value="">Любая модерация</option><option value="incomplete">Черновик</option><option value="pending_moderation">На проверке</option><option value="approved">Одобрен</option><option value="rejected">Отклонён</option><option value="suspended">Приостановлен</option></select>
    {!useOperatorCityStore((state) => state.cityId) && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.without_city === 'true'} onChange={(event) => set('without_city', event.target.checked ? 'true' : '')} />Город не назначен</label>}
  </div>;
}
