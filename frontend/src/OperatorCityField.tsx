import { useEffect, useState } from 'react';
import type { City } from './AdminCitiesScreen';
import { useAuthStore } from './store';
import { baseURL } from './utils';

export default function OperatorCityField({ value, onChange, all = true }: { value: string; onChange: (id: string, city?: City) => void; all?: boolean }) {
  const token = useAuthStore((state) => state.token);
  const [cities, setCities] = useState<City[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${baseURL}/operator/cities/`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error('Не удалось загрузить города'); return response.json(); })
      .then((data) => { if (!controller.signal.aborted) setCities(data); })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [token]);
  return <label className="block text-sm font-semibold">Город
    <select required={!all} value={value} className="ml-2 rounded-xl border bg-white p-2" onChange={(event) => onChange(event.target.value, cities.find((city) => city.id === event.target.value))}>
      <option value="">{all ? 'Все города' : 'Выберите город'}</option>
      {cities.filter((city) => all || city.is_active).map((city) => <option key={city.id} value={city.id}>{city.name}, {city.region}{city.is_active ? '' : ' (отключён)'}</option>)}
    </select>
    {error && <span role="alert">{error}</span>}
  </label>;
}
