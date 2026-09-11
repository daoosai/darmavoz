import { useEffect, useRef, useState, type FormEvent } from "react";
import { Building2, Edit2, Loader2, MapPin, Minus, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import toast from "react-hot-toast";
import AddressSuggestDropdown from "./components/AddressSuggestDropdown";
import MapWebGLFallback, { load2GisMapSdk, tryCreate2GisMap } from "./components/MapWebGLFallback";
import { fetch2gisCitySuggestions, get2gisCitySuggestionName, get2gisCitySuggestionRegion, get2gisSuggestionCoordinates, get2gisSuggestionLabel } from "./addressSearch";
import { useAuthStore } from "./store";
import { baseURL } from "./utils";

export interface City {
  id: string; name: string; region: string; code: string;
  center_lat: number; center_lon: number; map_zoom: number;
  min_lat: number; min_lon: number; max_lat: number; max_lon: number;
  is_active: boolean; is_default: boolean; sort_order: number;
}

type Draft = { id?: string; name: string; region: string; center_lat: string; center_lon: string; map_zoom: string };
const emptyDraft = (): Draft => ({ name: "", region: "", center_lat: "", center_lon: "", map_zoom: "11" });
const inputClass = "mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-medium text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100";
const parseNumber = (value: string) => Number(value.replace(",", "."));

function CityMapPreview({ latitude, longitude, zoom }: { latitude: string; longitude: string; zoom: string }) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const isInitializingRef = useRef(false);
  const isMountedRef = useRef(true);
  const valuesRef = useRef<{ lat: number; lon: number; zoom: number } | null>(null);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const lat = parseNumber(latitude);
  const lon = parseNumber(longitude);
  const parsedZoom = parseNumber(zoom);
  const coordinatesAreValid = Number.isFinite(lat) && Number.isFinite(lon);
  const effectiveZoom = Number.isFinite(parsedZoom) ? parsedZoom : 11;

  valuesRef.current = coordinatesAreValid ? { lat, lon, zoom: effectiveZoom } : null;

  const synchronizeMap = () => {
    const mapgl = (window as any).mapgl;
    const current = valuesRef.current;
    if (!mapRef.current || !mapgl || !current) return;
    const point: [number, number] = [current.lon, current.lat];
    mapRef.current.setCenter(point);
    mapRef.current.setZoom(current.zoom);
    if (markerRef.current) markerRef.current.setCoordinates(point);
    else markerRef.current = new mapgl.Marker(mapRef.current, { coordinates: point });
  };

  useEffect(() => () => {
    isMountedRef.current = false;
    markerRef.current?.destroy();
    markerRef.current = null;
    mapRef.current?.destroy();
    mapRef.current = null;
  }, []);

  useEffect(() => {
    if (!coordinatesAreValid || !mapContainerRef.current || mapRef.current || isInitializingRef.current) return;
    const key = import.meta.env.VITE_2GIS_KEY;
    if (!key) {
      setMapUnavailable(true);
      return;
    }
    isInitializingRef.current = true;
    void load2GisMapSdk().then((mapgl) => {
      const current = valuesRef.current;
      if (!isMountedRef.current || !mapContainerRef.current || mapRef.current || !current) {
        isInitializingRef.current = false;
        return;
      }
      const map = tryCreate2GisMap(
        () => new mapgl.Map(mapContainerRef.current, { center: [current.lon, current.lat], zoom: current.zoom, key }),
        () => setMapUnavailable(true),
      );
      if (!map) {
        isInitializingRef.current = false;
        return;
      }
      mapRef.current = map;
      synchronizeMap();
    }).catch(() => {
      isInitializingRef.current = false;
      if (isMountedRef.current) setMapUnavailable(true);
    });
  }, [coordinatesAreValid]);

  useEffect(() => { synchronizeMap(); }, [latitude, longitude, effectiveZoom]);

  return <div><p className="text-sm font-bold text-slate-700">Предпросмотр карты</p><div className="relative mt-1.5 h-48 overflow-hidden rounded-xl border border-slate-200 bg-slate-100"><div ref={mapContainerRef} className="h-full w-full" />{!coordinatesAreValid ? <div className="absolute inset-0 grid place-items-center bg-slate-100 px-6 text-center text-sm font-medium text-slate-500">Укажите широту и долготу центра, чтобы увидеть карту.</div> : null}{mapUnavailable ? <MapWebGLFallback className="absolute inset-0 h-full w-full" /> : null}</div></div>;
}

export default function AdminCitiesScreen({ onClose, modal = false }: { onClose?: () => void; modal?: boolean }) {
  const token = useAuthStore((state) => state.token);
  const [cities, setCities] = useState<City[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isNameFocused, setIsNameFocused] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  async function request(path = '', method = 'GET', payload?: object) {
    const res = await fetch(`${baseURL}/admin/cities/${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    const data = res.status === 204 ? null : await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(typeof data?.detail === 'string' ? data.detail : 'Проверьте поля города') as Error & { status?: number };
      error.status = res.status;
      throw error;
    }
    return data;
  }
  async function refresh() {
    setError('');
    try { setCities(await request()); }
    catch (err) { setError((err as Error).message); }
  }
  useEffect(() => { void refresh(); }, [token]);
  useEffect(() => {
    if (!draft || !isNameFocused || draft.name.trim().length < 3) { setSuggestions([]); return undefined; }
    let cancelled = false;
    const timer = window.setTimeout(() => { void fetch2gisCitySuggestions(draft.name).then((items) => { if (!cancelled) setSuggestions(items); }); }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [draft?.name, isNameFocused]);
  const update = (patch: Partial<Draft>) => setDraft((current) => current ? { ...current, ...patch } : current);
  const changeZoom = (delta: number) => setDraft((current) => {
    if (!current) return current;
    const currentZoom = parseNumber(current.map_zoom);
    const normalizedZoom = Number.isFinite(currentZoom) ? currentZoom : 11;
    return { ...current, map_zoom: String(Math.min(20, Math.max(1, Math.round(normalizedZoom) + delta))) };
  });
  const closeDialog = () => { setDraft(null); setSuggestions([]); setIsNameFocused(false); };
  const openEdit = (city: City) => { setError(''); setSuggestions([]); setIsNameFocused(false); setDraft({ id: city.id, name: city.name, region: city.region, center_lat: String(city.center_lat), center_lon: String(city.center_lon), map_zoom: String(city.map_zoom) }); };
  const selectSuggestion = (item: any) => {
    const { lat, lon } = get2gisSuggestionCoordinates(item);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { setError('2ГИС не вернул координаты этого города. Укажите их вручную.'); setSuggestions([]); return; }
    setIsNameFocused(false);
    update({ name: get2gisCitySuggestionName(item), region: get2gisCitySuggestionRegion(item) || draft?.region || '', center_lat: String(lat), center_lon: String(lon) });
    setSuggestions([]);
  };
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true); setError('');
    try {
      await request(draft.id ?? '', draft.id ? 'PATCH' : 'POST', {
        name: draft.name.trim(), region: draft.region.trim(),
        center_lat: Number(draft.center_lat.replace(',', '.')), center_lon: Number(draft.center_lon.replace(',', '.')), map_zoom: Number(draft.map_zoom.replace(',', '.')),
      });
      await refresh(); closeDialog();
    }
    catch (err) {
      const requestError = err as Error & { status?: number };
      const message = !draft.id && requestError.status === 400 ? 'Этот город уже имеется в базе' : requestError.message;
      setError(message);
      toast.error(message);
    }
    finally { setBusy(false); }
  }
  async function toggleActive(city: City) {
    setBusy(true); setError('');
    try { await request(city.id, 'PATCH', { is_active: !city.is_active }); await refresh(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function setDefault(city: City) {
    setBusy(true); setError('');
    try { await request(city.id, 'PATCH', { is_default: true }); await refresh(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function deleteCity(city: City) {
    if (!window.confirm(`Удалить город «${city.name}»?`)) return;
    setBusy(true); setError('');
    try {
      await request(city.id, 'DELETE');
      await refresh();
      toast.success('Город удалён');
    }
    catch (err) {
      const message = (err as Error).message;
      setError(message);
      toast.error(message);
    }
    finally { setBusy(false); }
  }
  const content = <section className={modal ? "space-y-6" : "space-y-6 pt-16"} aria-label="Управление городами">
    <div className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-sky-600">Настройки мультигородов</p><h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900">Управление городами</h1><p className="mt-2 text-sm text-slate-500">Города определяют карту, каталог и доступные точки для клиентов.</p></div><div className="flex gap-2"><button type="button" onClick={() => void refresh()} className="rounded-xl border border-slate-200 p-3 text-slate-600 transition hover:bg-slate-50" aria-label="Обновить список городов"><RefreshCw className="h-5 w-5" /></button><button type="button" onClick={() => { setError(''); setSuggestions([]); setIsNameFocused(false); setDraft(emptyDraft()); }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-3 font-bold text-white shadow-sm transition hover:bg-sky-600"><Plus className="h-5 w-5" />Добавить город</button></div></div>
    {error && !draft ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm font-medium text-red-700">{error}</p> : null}
    {cities.length === 0 && !error ? <div className="rounded-2xl bg-white p-10 text-center text-slate-500 shadow-sm"><Building2 className="mx-auto mb-3 h-8 w-8 text-slate-300" />Города ещё не добавлены.</div> : null}
    <div className="grid gap-4 lg:grid-cols-2">{cities.map((city) => <article key={city.id} className="rounded-2xl bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><h2 className="truncate text-lg font-black text-slate-900">{city.name}</h2><p className="mt-1 text-sm text-slate-500">{city.region}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${city.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{city.is_active ? 'Активен' : 'Черновик'}</span></div><div className="mt-4 flex items-center gap-2 text-sm text-slate-600"><MapPin className="h-4 w-4 text-sky-500" />{city.center_lat.toFixed(5)}, {city.center_lon.toFixed(5)} · масштаб {city.map_zoom}</div><div className="mt-5 flex flex-wrap gap-3 border-t border-slate-100 pt-4"><button type="button" disabled={busy} onClick={() => openEdit(city)} className="inline-flex items-center gap-2 font-bold text-sky-700 disabled:opacity-50"><Edit2 className="h-4 w-4" />Изменить</button><button type="button" disabled={busy || city.is_default} onClick={() => void toggleActive(city)} className="font-bold text-slate-600 disabled:cursor-not-allowed disabled:opacity-40">{city.is_active ? 'Отключить' : 'Опубликовать'}</button>{city.is_active && !city.is_default ? <button type="button" disabled={busy} onClick={() => void setDefault(city)} className="font-bold text-slate-600 disabled:opacity-50">Сделать основным</button> : null}{city.is_default ? <span className="text-sm font-semibold text-slate-400">Город по умолчанию</span> : null}<button type="button" disabled={busy} onClick={() => void deleteCity(city)} className="inline-flex items-center gap-2 font-bold text-red-600 transition hover:text-red-700 disabled:opacity-50"><Trash2 className="h-4 w-4" />Удалить</button></div></article>)}</div>
    {draft ? <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-900/40 p-4 pt-[max(env(safe-area-inset-top),2.5rem)] backdrop-blur-sm"><div role="dialog" aria-modal="true" aria-label={draft.id ? 'Редактировать город' : 'Добавить город'} className="max-h-full w-full max-w-xl overflow-y-auto rounded-3xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-100 px-6 py-5"><div><h2 className="text-xl font-black text-slate-900">{draft.id ? 'Редактировать город' : 'Добавить город'}</h2><p className="mt-1 text-sm text-slate-500">Выберите город из подсказки 2ГИС для автозаполнения.</p></div><button type="button" onClick={closeDialog} className="rounded-full p-2 text-slate-400 hover:bg-slate-100" aria-label="Закрыть"><X className="h-5 w-5" /></button></div><form onSubmit={save} className="space-y-5 p-6">{error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-700">{error}</p> : null}<label className="block text-sm font-bold text-slate-700">Название<div className="relative mt-1.5"><Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" /><input ref={nameInputRef} required autoComplete="off" value={draft.name} onFocus={() => setIsNameFocused(true)} onBlur={() => window.setTimeout(() => setIsNameFocused(false), 150)} onChange={(event) => update({ name: event.target.value })} placeholder="Начните вводить город" className={`${inputClass} mt-0 pl-11`} />{suggestions.length > 0 ? <AddressSuggestDropdown anchorRef={nameInputRef} isOpen>{suggestions.map((item, index) => <li key={`${get2gisSuggestionLabel(item)}-${index}`} role="option" onMouseDown={(event) => { event.preventDefault(); selectSuggestion(item); }} className="flex cursor-pointer items-start gap-2 px-4 py-3 text-sm hover:bg-sky-50"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" /><span>{get2gisSuggestionLabel(item)}</span></li>)}</AddressSuggestDropdown> : null}</div></label><label className="block text-sm font-bold text-slate-700">Регион<input required value={draft.region} onChange={(event) => update({ region: event.target.value })} className={inputClass} /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-bold text-slate-700">Широта центра<input required inputMode="decimal" value={draft.center_lat} onChange={(event) => update({ center_lat: event.target.value })} className={inputClass} /></label><label className="block text-sm font-bold text-slate-700">Долгота центра<input required inputMode="decimal" value={draft.center_lon} onChange={(event) => update({ center_lon: event.target.value })} className={inputClass} /></label></div><label className="block text-sm font-bold text-slate-700">Масштаб карты<div className="mt-1.5 flex h-12 items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50"><button type="button" onClick={() => changeZoom(-1)} disabled={parseNumber(draft.map_zoom) <= 1} className="grid h-full w-12 place-items-center border-r border-slate-200 text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Уменьшить масштаб"><Minus className="h-5 w-5" /></button><output className="flex-1 text-center text-base font-black text-slate-900" aria-live="polite">{Math.min(20, Math.max(1, Number.isFinite(parseNumber(draft.map_zoom)) ? parseNumber(draft.map_zoom) : 11))}</output><button type="button" onClick={() => changeZoom(1)} disabled={parseNumber(draft.map_zoom) >= 20} className="grid h-full w-12 place-items-center border-l border-slate-200 text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Увеличить масштаб"><Plus className="h-5 w-5" /></button></div></label><CityMapPreview latitude={draft.center_lat} longitude={draft.center_lon} zoom={draft.map_zoom} /><div className="flex justify-end gap-3 border-t border-slate-100 pt-5"><button type="button" onClick={closeDialog} className="rounded-xl px-4 py-3 font-bold text-slate-600 hover:bg-slate-100">Отмена</button><button disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-3 font-bold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Сохранить</button></div></form></div></div> : null}
  </section>;
  return modal ? <div className="fixed inset-0 z-[99999] overflow-hidden bg-slate-100 p-4 pt-[max(env(safe-area-inset-top),2.5rem)]"><div className="mx-auto max-h-full max-w-5xl overflow-y-auto">{onClose ? <button type="button" onClick={onClose} className="mb-4 font-bold text-sky-700">← Назад</button> : null}{content}</div></div> : content;
}
