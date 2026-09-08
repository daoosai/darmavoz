import { useEffect, useState } from 'react';
import { baseURL } from './utils';
import type { City } from './AdminCitiesScreen';

export default function RegistrationCitiesField({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const [cities, setCities] = useState<City[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${baseURL}/cities/`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('Не удалось загрузить города');
      const data: City[] = await response.json();
      if (controller.signal.aborted) return;
      setCities(data);
      const legacy = data.find((city) => city.code === 'tyumen');
      if (!value.length && legacy) onChange([legacy.id]);
    }).catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, []);
  return <fieldset className="space-y-2 rounded-xl border p-3"><legend className="font-bold">Города обслуживания</legend>
    {error && <p role="alert">{error}</p>}
    {cities.map((city) => <label className="flex gap-2" key={city.id}><input type="checkbox" checked={value.includes(city.id)} onChange={(event) => onChange(event.target.checked ? [...value, city.id] : value.filter((id) => id !== city.id))} />{city.name}, {city.region}</label>)}
  </fieldset>;
}
