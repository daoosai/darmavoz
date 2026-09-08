import { useEffect, useState, type ReactNode } from 'react';
import { App } from '@capacitor/app';
import { useCityStore } from './cityStore';
import { useAddressStore, useCartStore } from './store';

export function CitySelector({ onClose }: { onClose?: () => void }) {
  const { cities, cityId, choose, refresh, error } = useCityStore();
  const [search, setSearch] = useState('');
  useEffect(() => { void refresh(); }, [refresh]);
  const unavailable = cityId && !cities.some((city) => city.id === cityId);
  return <section role="dialog" aria-modal="true" aria-label="Выбор города" className="fixed inset-0 z-[110] overflow-y-auto bg-white pt-[max(env(safe-area-inset-top),2.5rem)]">
    <div className="mx-auto max-w-md space-y-4 p-4">
      {onClose && !unavailable && <button className="text-sky-600" onClick={onClose}>← Назад</button>}
      <h1 className="text-2xl font-bold">Выберите город</h1>
      {unavailable && <p>Выбранный город отключён. Его корзина сохранена. Для нового заказа выберите другой город.</p>}
      {error && <p role="alert">{error} <button onClick={() => void refresh()}>Повторить</button></p>}
      <input aria-label="Поиск города" className="w-full rounded-xl border p-3" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Город или регион" />
      {cities.filter((city) => `${city.name} ${city.region}`.toLowerCase().includes(search.toLowerCase())).map((city) => <button key={city.id} className="block w-full rounded-xl border p-3 text-left" onClick={() => { choose(city.id); onClose?.(); }}>
        <strong>{city.name}</strong><span className="block text-sm text-slate-500">{city.region}</span>
      </button>)}
      {!cities.length && <p>Нет доступных городов</p>}
    </div>
  </section>;
}

export default function CityBoundary({ children }: { children: ReactNode }) {
  const { cities, cityId, loaded, refresh, error } = useCityStore();
  const city = cities.find((item) => item.id === cityId);
  const cartCityId = useCartStore((state) => state.cartCityId);
  useEffect(() => {
    void refresh();
    const resume = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', resume);
    const subscription = App.addListener('appStateChange', ({ isActive }) => { if (isActive) void refresh(); });
    return () => { document.removeEventListener('visibilitychange', resume); void subscription.then((handle) => handle.remove()); };
  }, [refresh]);
  useEffect(() => {
    if (!city) return;
    const state = useCartStore.getState();
    if (state.cartCityId !== city.id) {
      state.switchCityCart(city.id, city.code === 'tyumen');
      useAddressStore.getState().clearSelectedAddress();
    }
  }, [city]);
  if (!loaded) return <div className="p-6 pt-[max(env(safe-area-inset-top),2.5rem)]">{error || 'Загрузка городов…'}{error && <button onClick={() => void refresh()}>Повторить</button>}</div>;
  if (!city) return <CitySelector />;
  if (cartCityId !== city.id) return null;
  return <div key={cityId}>{children}</div>;
}
