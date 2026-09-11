import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { City } from './AdminCitiesScreen';
import { useAddressStore, useCartStore } from './store';
import { baseURL } from './utils';

interface CityState {
  cityId: string | null;
  cities: City[];
  loaded: boolean;
  error: string;
  choose: (id: string, options?: { preserveAddress?: boolean }) => void;
  refresh: () => Promise<void>;
}
let revision = 0;
const FALLBACK_MAP_CENTER: [number, number] = [65.534328, 57.152286];
const FALLBACK_MAP_ZOOM = 11;

function fallbackCity(cities: City[]): City | null {
  return cities.find((city) => city.is_active && city.code === 'tyumen')
    ?? cities.find((city) => city.is_active && city.is_default)
    ?? cities.find((city) => city.is_active)
    ?? null;
}

function syncCityScopedState(city: City, preserveAddress = false): void {
  const cart = useCartStore.getState();
  if (cart.cartCityId === city.id) return;

  cart.switchCityCart(city.id, city.code === 'tyumen');
  if (!preserveAddress) useAddressStore.getState().clearSelectedAddress();
}

export const useCityStore = create<CityState>()(persist((set, get) => ({
  cityId: null, cities: [], loaded: false, error: '',
  choose: (id, options = {}) => {
    const city = get().cities.find((item) => item.id === id && item.is_active);
    if (!city) throw new Error('Город недоступен');
    set({ cityId: city.id });
    syncCityScopedState(city, Boolean(options.preserveAddress));
  },
  refresh: async () => {
    const request = ++revision;
    try {
      const response = await fetch(`${baseURL}/cities/`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Не удалось загрузить города');
      const cities: City[] = await response.json();
      if (request !== revision) return;
      const selectedCity = cities.find((city) => city.id === get().cityId && city.is_active)
        ?? fallbackCity(cities);
      set({ cities, loaded: true, error: '', cityId: selectedCity?.id ?? null });
      if (selectedCity) syncCityScopedState(selectedCity);
    } catch {
      if (request === revision) set({ error: 'Не удалось обновить список городов. Повторите попытку.' });
    }
  },
}), { name: 'selected-city', version: 1, partialize: (state) => ({ cityId: state.cityId }) }));

export function currentCity(cityId?: string): City {
  const state = useCityStore.getState();
  const city = state.cities.find((item) => item.id === (cityId ?? state.cityId) && item.is_active);
  if (!state.loaded || !city) throw new Error('Выберите доступный город');
  return city;
}

export function cityMapCenter(city: City | null | undefined): [number, number] {
  if (
    city
    && Number.isFinite(city.center_lat)
    && Number.isFinite(city.center_lon)
  ) {
    return [city.center_lon, city.center_lat];
  }
  return FALLBACK_MAP_CENTER;
}

export function cityMapZoom(city: City | null | undefined): number {
  return city && Number.isFinite(city.map_zoom)
    ? city.map_zoom
    : FALLBACK_MAP_ZOOM;
}

// Public requests capture their city, including response parsing. Late responses
// from a previous city cannot update the current catalogue or delivery selection.
export async function cityFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const city = currentCity();
  const url = new URL(input.toString(), window.location.origin);
  url.searchParams.set('city_id', city.id);
  let options = init;
  if (typeof init?.body === 'string') {
    const payload = JSON.parse(init.body);
    options = { ...init, body: JSON.stringify({ ...payload, city_id: city.id }) };
  }
  const response = await fetch(url, options);
  const valid = () => {
    if (useCityStore.getState().cityId !== city.id) throw new DOMException('Город изменён', 'AbortError');
  };
  valid();
  const parse = response.json.bind(response);
  response.json = async () => { const data = await parse(); valid(); return data; };
  return response;
}
