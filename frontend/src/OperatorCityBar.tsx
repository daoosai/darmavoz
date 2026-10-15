import { useEffect } from 'react';
import { MapPin } from 'lucide-react';
import OperatorCityField from './OperatorCityField';
import { useOperatorCityStore } from './operatorCityStore';
import { useAuthStore } from './store';
import { baseURL } from './utils';
export default function OperatorCityBar() {
  const { cityId, choose, setCities } = useOperatorCityStore();
  const token = useAuthStore((state) => state.token);
  useEffect(() => {
    const controller = new AbortController();
    fetch(baseURL + '/operator/cities/', { headers: { Authorization: 'Bearer ' + token }, signal: controller.signal })
      .then(async (response) => { if (response.ok) setCities(await response.json()); }).catch(() => {});
    return () => controller.abort();
  }, [token, setCities]);
  return <div className="mx-auto mt-3 flex max-w-7xl items-center gap-2 px-4 text-slate-600 sm:px-6 lg:px-8">
    <MapPin className="h-4 w-4 shrink-0 text-sky-500" /><OperatorCityField value={cityId} onChange={choose} />
  </div>;
}
export function CityLabel({ cityId, cityName }: { cityId?: string | null; cityName?: string | null }) {
  const cities = useOperatorCityStore((state) => state.cities);
  return <span className="text-xs font-semibold text-sky-700">{cityName || cities.find((city) => city.id === cityId)?.name || 'Город не назначен'}</span>;
}
