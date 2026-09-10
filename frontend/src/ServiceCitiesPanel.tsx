import { useEffect, useState } from 'react';
import { useAuthStore } from './store';
import { baseURL } from './utils';
import type { City } from './AdminCitiesScreen';

export default function ServiceCitiesPanel({ userId, driverId }: { userId?: string; driverId?: string }) {
  const token = useAuthStore((state) => state.token);
  const [cities, setCities] = useState<City[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(true);
  const path = driverId ? `/admin/drivers/${driverId}/cities` : userId ? `/admin/users/${userId}/cities` : '/profile/cities';
  useEffect(() => {
    const controller = new AbortController();
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${baseURL}${userId || driverId ? '/admin/cities/' : '/cities/'}`, { headers, signal: controller.signal }),
      fetch(`${baseURL}${path}`, { headers, signal: controller.signal }),
    ]).then(async ([cityRes, profileRes]) => {
      if (!cityRes.ok || !profileRes.ok) throw new Error('Не удалось загрузить города обслуживания');
      const [available, profile] = await Promise.all([cityRes.json(), profileRes.json()]);
      if (!controller.signal.aborted) { setCities(available); setSelected(profile.city_ids); }
    }).catch((err) => { if (!controller.signal.aborted) setMessage(err.message); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [path, token, userId, driverId]);
  return <section className="space-y-3 rounded-2xl border bg-white p-4">
    <h2 className="font-bold">Города обслуживания</h2>
    {cities.map((city) => <label key={city.id} className="flex gap-2"><input type="checkbox" checked={selected.includes(city.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, city.id] : selected.filter((id) => id !== city.id))} />{city.name}, {city.region}{!city.is_active ? ' (неактивен)' : ''}</label>)}
    <p aria-live="polite" className="text-sm">{message}</p>
    <button type="button" disabled={busy || selected.length === 0} className="rounded-xl bg-sky-500 p-3 text-white disabled:opacity-40" onClick={async () => {
      setBusy(true); setMessage('');
      try {
        const response = await fetch(`${baseURL}${path}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ city_ids: selected }) });
        const data = await response.json();
        if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Не удалось сохранить');
        setSelected(data.city_ids); setMessage('Города сохранены. Принятые заказы продолжают обслуживаться.');
      } catch (err) { setMessage((err as Error).message); }
      finally { setBusy(false); }
    }}>Сохранить города</button>
  </section>;
}
