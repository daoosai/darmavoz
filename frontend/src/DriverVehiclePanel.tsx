import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { commerceApi, inputClass, buttonClass } from './commerceApi';

const fieldsFrom = (vehicle: any) => ({
  vehicle_id: vehicle?.id || '',
  vehicle_brand: vehicle?.brand || '',
  vehicle_plate_number: vehicle?.plate_number || '',
  vehicle_type: vehicle?.vehicle_type || 'Самосвал',
  transport_category_id: vehicle?.transport_category_id || vehicle?.transport_category?.id || '',
  delivery_option_id: vehicle?.delivery_option_id || vehicle?.delivery_option?.id || '',
  cubature_min: String(vehicle?.cubature_min ?? ''),
  cubature_max: String(vehicle?.cubature_max ?? ''),
  tonnage_min: String(vehicle?.tonnage_min ?? ''),
  tonnage_max: String(vehicle?.tonnage_max ?? ''),
});

export default function DriverVehiclePanel({ driver, onClose, onSaved }: { driver: any; onClose: () => void; onSaved?: () => void }) {
  const [form, setForm] = useState(() => fieldsFrom(driver.vehicle));
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [options, setOptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    Promise.all([
      commerceApi(`/admin/drivers/${driver.id}/vehicles`),
      commerceApi('/transport-categories'),
      commerceApi('/catalog/delivery-options/'),
    ]).then(([available, categories, options]) => {
      if (!active) return;
      setVehicles(available); setCategories(categories); setOptions(options.filter((option: any) => option.is_active !== false));
    }).catch(error => { if (active) { setError(error.message); setLoadFailed(true); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [driver.id]);
  const set = (field: keyof typeof form, value: string) => setForm(current => ({ ...current, [field]: value }));
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (Number(form.cubature_min) > Number(form.cubature_max)) { setError('Минимальная кубатура не может превышать максимальную'); return; }
    setSaving(true);
    try {
      const payload: any = { ...form, vehicle_id: form.vehicle_id || undefined, delivery_option_id: form.delivery_option_id || undefined, transport_category_id: form.transport_category_id || null };
      for (const field of ['cubature_min', 'cubature_max', 'tonnage_min', 'tonnage_max']) payload[field] = form[field] ? Number(form[field]) : null;
      await commerceApi(`/admin/drivers/${driver.id}/vehicle`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast.success('Транспорт водителя сохранён'); onSaved?.(); onClose();
    } catch (error: any) { setError(error.message); }
    finally { setSaving(false); }
  };
  return <section role="dialog" aria-modal="true" aria-label="Транспорт водителя" className="fixed inset-0 z-[10000] flex flex-col overflow-y-auto bg-slate-50 text-slate-900">
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 pb-4 pt-[max(env(safe-area-inset-top),2.5rem)]">
      <div><h2 className="text-lg font-bold">Транспорт водителя</h2><p className="text-xs text-slate-500">{driver.name}</p></div>
      <button type="button" aria-label="Закрыть транспорт" disabled={saving} onClick={onClose} className="rounded-xl bg-slate-100 p-3"><X className="h-5 w-5" /></button>
    </header>
    <form onSubmit={save} className="mx-auto flex w-full max-w-xl flex-col gap-4 p-5 pb-[max(env(safe-area-inset-bottom),2rem)]">
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading ? <p>Загружаем транспорт…</p> : <>
        <label className="text-sm font-bold">Машина<select aria-label="Машина" className={inputClass} value={form.vehicle_id} onChange={event => setForm(fieldsFrom(vehicles.find(vehicle => vehicle.id === event.target.value)))}><option value="">Заполнить транспорт водителя</option>{vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.title || vehicle.brand} · {vehicle.plate_number || 'Без номера'}</option>)}</select></label>
        <label className="text-sm font-bold">Марка машины<input required className={inputClass} value={form.vehicle_brand} onChange={event => set('vehicle_brand', event.target.value)} /></label>
        <label className="text-sm font-bold">Госномер<input required className={inputClass} value={form.vehicle_plate_number} onChange={event => set('vehicle_plate_number', event.target.value.toUpperCase())} /></label>
        <label className="text-sm font-bold">Тип машины<input required className={inputClass} value={form.vehicle_type} onChange={event => set('vehicle_type', event.target.value)} /></label>
        <label className="text-sm font-bold">Категория транспорта<select aria-label="Категория транспорта" className={inputClass} required={!form.delivery_option_id} value={form.transport_category_id} onChange={event => set('transport_category_id', event.target.value)}><option value="">По варианту доставки</option>{categories.map(category => <option key={category.id} value={category.id}>{category.title}</option>)}</select></label>
        <label className="text-sm font-bold">Вариант доставки<select aria-label="Вариант доставки" className={inputClass} value={form.delivery_option_id} onChange={event => set('delivery_option_id', event.target.value)}><option value="">Без варианта доставки</option>{options.map(option => <option key={option.id} value={option.id}>{option.title} · {option.capacity_m3} м³</option>)}</select></label>
        <div className="grid grid-cols-2 gap-3">{(['cubature_min', 'cubature_max', 'tonnage_min', 'tonnage_max'] as const).map((field, index) => <label key={field} className="text-sm font-bold">{['Кубатура от, м³', 'Кубатура до, м³', 'Тоннаж от, т', 'Тоннаж до, т'][index]}<input required={index < 2} type="number" min="0.1" step="0.1" className={inputClass} value={form[field]} onChange={event => set(field, event.target.value)} /></label>)}</div>
        <button disabled={saving || loadFailed} className={buttonClass}>{saving ? 'Сохраняем…' : 'Сохранить'}</button>
      </>}
    </form>
  </section>;
}
