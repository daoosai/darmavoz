import { useEffect, useState } from 'react';
import { baseURL } from './utils';
import { Bell, BellOff, MapPin } from 'lucide-react';
import ServiceCitiesPanel from './ServiceCitiesPanel';
import DriverVehiclePanel from './DriverVehiclePanel';
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
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const names = (driver.city_ids || []).map((id: string) => cities.find((city) => city.id === id)?.name || id.slice(0, 8));
  const category = driver.vehicle?.transport_category?.title || driver.vehicle?.delivery_option?.transport_category?.title;
  const hasCategory = !!(category || driver.effective_transport_category_id);
  const status = driver.status === 'available' || driver.status === 'free' ? 'available' : driver.status === 'busy' ? 'busy' : 'offline';
  const reasons = (driver.dispatch_exclusion_reasons || []).map((reason: string) => driverReasonLabels[reason] || 'Требуется проверка модерации').join(' · ');
  const pushLabel = driver.has_push_token ? 'Push: устройство подключено' : 'Push: устройство не подключено';
  const chip = 'inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold';
  return <div className="mt-2 space-y-2 text-xs">
    <div className="flex flex-wrap gap-1.5" aria-label="Города водителя">
      {names.length ? names.map((name: string, index: number) => <span key={driver.city_ids[index]} className={chip + ' bg-sky-100 text-sky-800'}><MapPin className="h-3.5 w-3.5 shrink-0" />{name}</span>) : <span className={chip + ' bg-amber-50 text-amber-800'}><MapPin className="h-3.5 w-3.5" />Город не назначен</span>}
    </div>
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Статусы водителя">
      <span tabIndex={0} title={reasons || 'Доступен для подбора; геопозиция проверяется при распределении'} className={chip + (driver.is_active === false || status === 'offline' ? ' bg-red-50 text-red-700' : status === 'busy' ? ' bg-amber-50 text-amber-800' : ' bg-emerald-50 text-emerald-700')}>{driver.is_active === false ? 'Аккаунт отключён' : status === 'available' ? 'Свободен' : status === 'busy' ? 'Занят' : 'Недоступен'}</span>
      <span className={chip + (driver.is_on_shift ? ' bg-emerald-50 text-emerald-700' : ' bg-slate-100 text-slate-600')}>{driver.is_on_shift ? 'На смене' : 'Не на смене'}</span>
      <span title={category || undefined} className={chip + (hasCategory ? ' bg-emerald-50 text-emerald-700' : ' bg-amber-50 text-amber-800')}>{hasCategory ? category || 'Категория назначена' : 'Категория требует проверки'}</span>
      <span tabIndex={0} title={pushLabel} aria-label={pushLabel} className={chip + (driver.has_push_token ? ' bg-emerald-50 text-emerald-700' : ' bg-slate-100 text-slate-500')}>{driver.has_push_token ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}</span>
    </div>
    {driver.current_order_id && <p className="font-semibold text-amber-700">Текущий заказ №{driver.current_order_id.slice(0, 8)}</p>}
    {driver.last_location_updated_at && <p className="text-slate-500">Геопозиция: {new Date(driver.last_location_updated_at).toLocaleString('ru-RU')}</p>}
    {editable && <><button type="button" onClick={() => setOpen(!open)} className="rounded-xl bg-sky-50 px-3 py-2 font-bold text-sky-700">Города обслуживания</button>{open && <ServiceCitiesPanel driverId={driver.id} onSaved={onSaved} />}<button type="button" onClick={() => setVehicleOpen(true)} className="ml-2 rounded-xl bg-sky-50 px-3 py-2 font-bold text-sky-700">Назначить машину</button>{vehicleOpen && <DriverVehiclePanel driver={driver} onClose={() => setVehicleOpen(false)} onSaved={onSaved} />}</>}
  </div>;
}
export function DriverFilters({ value, onChange }: { value: Record<string, string>; onChange: (value: Record<string, string>) => void }) {
  const cities = useOperatorCityStore((state) => state.cities);
  const cityId = useOperatorCityStore((state) => state.cityId);
  const [categories, setCategories] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => { const controller = new AbortController(); fetch(baseURL + "/catalog/transport-categories", { signal: controller.signal }).then(async (response) => { if (response.ok) setCategories(await response.json()); }).catch(() => {}); return () => controller.abort(); }, []);
  const set = (key: string, next: string) => onChange({ ...value, [key]: next });
  return <div className="mb-3 grid gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm sm:grid-cols-3">
    <input aria-label="Поиск водителя" placeholder="Имя, телефон или госномер" value={value.q || ''} onChange={(event) => set('q', event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" />
    <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">Фильтр по городу
      <select aria-label="Фильтр по городу" value={value.city_id || ''} onChange={(event) => onChange({ ...value, city_id: event.target.value, without_city: '' })} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
        <option value="">{cityId ? 'Глобальный: ' + (cities.find((city) => city.id === cityId)?.name || 'выбранный город') : 'Все города'}</option>
        {cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
      </select>
    </label>
    <select aria-label="Статус водителя" value={value.status || ''} onChange={(event) => set('status', event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><option value="">Все статусы</option><option value="available">Доступен</option><option value="busy">Занят</option><option value="offline">Недоступен</option></select>
    <select aria-label="Смена" value={value.is_on_shift || ''} onChange={(event) => set('is_on_shift', event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><option value="">Все смены</option><option value="true">На смене</option><option value="false">Не на смене</option></select>
    <select aria-label="Категория транспорта" value={value.transport_category_id || ""} onChange={(event) => set("transport_category_id", event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><option value="">Все категории</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}</select>
    <input aria-label="Кубатура" type="number" min="0.1" step="0.1" placeholder="Кубатура рейса, м³" value={value.volume || ''} onChange={(event) => set('volume', event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" />
    <select aria-label="Допуск" value={value.is_dispatch_eligible || ''} onChange={(event) => set('is_dispatch_eligible', event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><option value="">Любой допуск</option><option value="true">Допущен</option><option value="false">Без допуска</option></select>
    <select aria-label="Модерация" value={value.moderation_status || ''} onChange={(event) => set('moderation_status', event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><option value="">Любая модерация</option><option value="incomplete">Черновик</option><option value="pending_moderation">На проверке</option><option value="approved">Одобрен</option><option value="rejected">Отклонён</option><option value="suspended">Приостановлен</option></select>
    {!cityId && !value.city_id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.without_city === 'true'} onChange={(event) => set('without_city', event.target.checked ? 'true' : '')} />Город не назначен</label>}
  </div>;
}
