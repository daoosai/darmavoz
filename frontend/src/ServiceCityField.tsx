import { useEffect, useRef, useState } from 'react';
import { baseURL } from './utils';
import { useAuthStore } from './store';
import type { City } from './AdminCitiesScreen';

export default function ServiceCityField({ value, onChange, onCityChange, admin = false }: { value: string; onChange: (id: string) => void; onCityChange?: (city: City) => void; admin?: boolean }) {
  const token = useAuthStore((state) => state.token);
  const [cities, setCities] = useState<City[]>([]);
  const [error, setError] = useState('');
  const onCityRef = useRef(onCityChange);
  onCityRef.current = onCityChange;
  useEffect(() => {
    const city = cities.find((item) => item.id === value);
    if (city) onCityRef.current?.(city);
  }, [cities, value]);
  useEffect(() => {
    const controller = new AbortController();
    const headers = { Authorization: `Bearer ${token}` };
    (async () => {
      const res = await fetch(`${baseURL}${admin ? '/operator/cities/' : '/cities/'}`, { headers, signal: controller.signal });
      if (!res.ok) throw new Error('Не удалось загрузить города');
      let data: City[] = await res.json();
      if (!admin) {
        const profile = await fetch(`${baseURL}/profile/cities`, { headers, signal: controller.signal });
        if (!profile.ok) throw new Error('Не удалось загрузить города обслуживания');
        const { city_ids } = await profile.json();
        data = data.filter((city) => city_ids.includes(city.id));
      }
      if (!controller.signal.aborted) setCities(data);
    })().catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [admin, token]);
  return <label className="block text-sm font-bold">Город обслуживания
    <select required className="mt-2 w-full rounded-xl border bg-white p-3" value={value} onChange={(event) => { onChange(event.target.value); const city = cities.find((item) => item.id === event.target.value); if (city) onCityChange?.(city); }}>
      <option value="">Выберите город</option>
      {value && !cities.some((city) => city.id === value) && <option value={value} disabled>Город недоступен</option>}
      {cities.map((city) => <option key={city.id} value={city.id}>{city.name}, {city.region}</option>)}
    </select>
    {error && <span role="alert">{error}</span>}
    {!cities.length && !error && <span className="block text-xs font-normal">Укажите города обслуживания в профиле.</span>}
  </label>;
}
