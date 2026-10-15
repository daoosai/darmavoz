import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { City } from './AdminCitiesScreen';
interface OperatorCityState {
  cityId: string; cities: City[];
  choose: (id: string) => void;
  setCities: (cities: City[]) => void;
}
export const useOperatorCityStore = create<OperatorCityState>()(persist((set) => ({
  cityId: '', cities: [], choose: (cityId) => set({ cityId }),
  setCities: (cities) => set((state) => ({ cities, cityId: cities.some((city) => city.id === state.cityId) ? state.cityId : '' })),
}), { name: 'operator-city', partialize: (state) => ({ cityId: state.cityId }) }));
const scopedLists = /^\/(?:admin\/(?:drivers|orders|suppliers|users|statistics|cars|pickup-points|quarries|equipment|water-points|septic-providers|moderation\/(?:pending|count)|sidebar\/counts|placements\/summary)|logist\/(?:orders|driver-map)|drivers)\/?$/;
export async function operatorFetch(input: RequestInfo | URL, init?: RequestInit, cityOverride?: string): Promise<Response> {
  const url = new URL(String(input), window.location.origin);
  const path = url.pathname.replace(/^\/api\/v1/, '');
  const scoped = (!init?.method || init.method.toUpperCase() === 'GET') && scopedLists.test(path);
  const cityId = useOperatorCityStore.getState().cityId;
  const requestCityId = cityOverride ?? cityId;
  if (scoped) {
    if (requestCityId) url.searchParams.set('city_id', requestCityId);
    else url.searchParams.delete('city_id');
  }
  const response = await fetch(scoped ? url : input, init);
  const valid = () => { if (scoped && cityId !== useOperatorCityStore.getState().cityId) throw new DOMException('Город изменён', 'AbortError'); };
  valid();
  const parse = response.json.bind(response);
  response.json = async () => { const data = await parse(); valid(); return data; };
  return response;
}
