import { useEffect, useState } from 'react';
import { useAuthStore } from './store';
import { baseURL } from './utils';

export interface City {
  id: string; name: string; region: string; code: string;
  center_lat: number; center_lon: number; map_zoom: number;
  min_lat: number; min_lon: number; max_lat: number; max_lon: number;
  is_active: boolean; is_default: boolean; sort_order: number;
}

const fields = [
  ['name', 'Название'], ['region', 'Регион'], ['code', 'Уникальный код'],
  ['center_lat', 'Широта центра'], ['center_lon', 'Долгота центра'], ['map_zoom', 'Масштаб карты (1–20)'],
  ['min_lat', 'Южная граница'], ['min_lon', 'Западная граница'],
  ['max_lat', 'Северная граница'], ['max_lon', 'Восточная граница'], ['sort_order', 'Порядок'],
] as const;
type Draft = Record<typeof fields[number][0], string>;
const empty = Object.fromEntries(fields.map(([key]) => [key, key === 'sort_order' ? '0' : ''])) as Draft;

export default function AdminCitiesScreen({ onClose }: { onClose: () => void }) {
  const token = useAuthStore((state) => state.token);
  const [cities, setCities] = useState<City[]>([]);
  const [editing, setEditing] = useState<City | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function request(path = '', method = 'GET', payload?: object) {
    const res = await fetch(`${baseURL}/admin/cities/${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Проверьте поля города');
    return data;
  }
  async function refresh() { setCities(await request()); }
  useEffect(() => { refresh().catch((err) => setError(err.message)); }, [token]);
  async function save(payload: object, id?: string) {
    setBusy(true); setError('');
    try { await request(id ?? '', id ? 'PATCH' : 'POST', payload); await refresh(); setDraft(null); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return <section role="dialog" aria-modal="true" aria-label="Города" className="fixed inset-0 z-[100] overflow-y-auto bg-white pt-[max(env(safe-area-inset-top),2.5rem)] pb-[max(env(safe-area-inset-bottom),1rem)]">
    <div className="mx-auto max-w-xl space-y-4 px-4">
      <button onClick={onClose} className="text-sky-600">← Назад</button>
      <h1 className="text-2xl font-bold">Города</h1>
      {error && <p role="alert" className="text-red-600">{error}</p>}
      <button className="rounded-xl bg-sky-500 p-3 text-white" onClick={() => { setEditing(null); setDraft({ ...empty }); }}>Добавить город</button>
      {draft && <form className="space-y-3 rounded-2xl border p-4" onSubmit={(event) => {
        event.preventDefault();
        const payload = Object.fromEntries(fields.map(([key], index) => [key, index < 3 ? draft[key].trim() : Number(draft[key].replace(',', '.'))]));
        save(payload, editing?.id);
      }}>
        {fields.map(([key, label], index) => <label key={key} className="block">{label}<input required className="w-full rounded-xl border p-3" inputMode={index < 3 ? 'text' : 'decimal'} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></label>)}
        <p className="text-sm text-slate-500">Новый город создаётся неактивным. После настройки предложений опубликуйте его.</p>
        <button disabled={busy} className="rounded-xl bg-sky-500 p-3 text-white disabled:opacity-50">Сохранить</button>
        <button type="button" onClick={() => setDraft(null)} className="ml-4">Отмена</button>
      </form>}
      {cities.map((city) => <article key={city.id} className="space-y-2 rounded-2xl border p-4">
        <h2 className="font-bold">{city.name}, {city.region}</h2>
        <p>{city.is_active ? 'Опубликован' : 'Неактивен'}{city.is_default ? ' · По умолчанию' : ''}</p>
        <div className="flex flex-wrap gap-3 text-sky-600">
          <button disabled={busy} onClick={() => { setEditing(city); setDraft(Object.fromEntries(fields.map(([key]) => [key, String(city[key])])) as Draft); }}>Изменить</button>
          <button disabled={busy} onClick={() => save({ is_active: !city.is_active }, city.id)}>{city.is_active ? 'Отключить' : 'Опубликовать'}</button>
          {city.is_active && !city.is_default && <button disabled={busy} onClick={() => save({ is_default: true }, city.id)}>По умолчанию</button>}
        </div>
      </article>)}
    </div>
  </section>;
}
