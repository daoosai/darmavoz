import { useRef, useState, type FormEvent } from "react";
import { Loader2, MapPin, Play } from "lucide-react";
import toast from "react-hot-toast";

import {
  fetch2gisAddressSuggestions,
  get2gisSuggestionAddress,
  get2gisSuggestionCoordinates,
  get2gisSuggestionLabel,
  withTyumenBias,
} from "../../addressSearch";
import { baseURL, extractApiErrorMessage } from "../../utils";

type ParserTarget = "material" | "water";

const parseCoordinate = (value: string) => Number.parseFloat(value.trim().replace(",", "."));

type AddressSuggestion = {
  label: string;
  address: string;
  lat?: number;
  lon?: number;
};

type ParserCoordinates = { lat: number; lon: number };

const keywords: Record<ParserTarget, string[]> = {
  material: ["карьер", "накопитель", "песок", "щебень", "пгс", "песчано-гравийная смесь"],
  water: ["вода", "питьевая вода", "техническая вода"],
};

export default function ParserRunPanel({
  target,
  token,
  onCompleted,
  onCoordinatesChange,
}: {
  target: ParserTarget;
  token: string | null;
  onCompleted?: () => void | Promise<void>;
  onCoordinatesChange?: (coordinates: ParserCoordinates) => void;
}) {
  const [city, setCity] = useState("Тюмень");
  const [lat, setLat] = useState("57.1522");
  const [lon, setLon] = useState("65.5272");
  const [radius, setRadius] = useState("10000");
  const [keyword, setKeyword] = useState(keywords[target][0]);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const suggestionRequestRef = useRef(0);

  const notifyCoordinates = (nextLat: string, nextLon: string) => {
    const parsedLat = parseCoordinate(nextLat);
    const parsedLon = parseCoordinate(nextLon);
    if (Number.isFinite(parsedLat) && Number.isFinite(parsedLon)) {
      onCoordinatesChange?.({ lat: parsedLat, lon: parsedLon });
    }
  };

  const handleCityChange = async (value: string) => {
    setCity(value);
    setShowSuggestions(true);
    const requestId = ++suggestionRequestRef.current;
    if (!value.trim()) {
      setSuggestions([]);
      return;
    }

    const items = await fetch2gisAddressSuggestions(value);
    if (requestId !== suggestionRequestRef.current) return;
    setSuggestions(
      items
        .map((item: any) => {
          const address = get2gisSuggestionAddress(item);
          const label = get2gisSuggestionLabel(item);
          return {
            label: label || address,
            address,
            ...get2gisSuggestionCoordinates(item),
          };
        })
        .filter((item) => Boolean(item.address)),
    );
  };

  const geocodeCity = async (value: string) => {
    setIsGeocoding(true);
    try {
      const response = await fetch(
        `${baseURL}/geo/geocode?address=${encodeURIComponent(withTyumenBias(value))}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
      );
      const data = await response.json().catch(() => ({}));
      const nextLat = Number(data.lat);
      const nextLon = Number(data.lon);
      if (response.ok && Number.isFinite(nextLat) && Number.isFinite(nextLon)) {
        const nextLatValue = String(nextLat);
        const nextLonValue = String(nextLon);
        setLat(nextLatValue);
        setLon(nextLonValue);
        notifyCoordinates(nextLatValue, nextLonValue);
      }
    } catch {
      toast.error("Не удалось определить координаты места");
    } finally {
      setIsGeocoding(false);
    }
  };

  const selectSuggestion = async (suggestion: AddressSuggestion) => {
    const nextCity = suggestion.address.trim() || suggestion.label.trim();
    setCity(nextCity);
    setSuggestions([]);
    setShowSuggestions(false);
    if (typeof suggestion.lat === "number" && typeof suggestion.lon === "number") {
      const nextLat = String(suggestion.lat);
      const nextLon = String(suggestion.lon);
      setLat(nextLat);
      setLon(nextLon);
      notifyCoordinates(nextLat, nextLon);
      return;
    }
    await geocodeCity(nextCity);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    setLoading(true);
    try {
      const centerLat = parseCoordinate(lat);
      const centerLon = parseCoordinate(lon);
      if (!Number.isFinite(centerLat) || !Number.isFinite(centerLon)) {
        throw new Error("Введите корректные координаты");
      }
      const response = await fetch(`${baseURL}/admin/parser/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ city, center_lat: centerLat, center_lon: centerLon, radius_m: Number(radius), target, keyword }),
      });
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({ status: response.status }));
        toast.error(extractApiErrorMessage(errorPayload, "Не удалось запустить импорт"));
        return;
      }
      const result = await response.json() as { total_found: number; created: number; updated: number; skipped: number; cross_target_conflicts: number; truncated: boolean };
      toast.success(`Парсинг завершен! Найдено: ${result.total_found}, Создано: ${result.created}, Обновлено: ${result.updated}, Пропущено: ${result.skipped}${result.truncated ? ". Достигнут лимит" : ""}`);
      await onCompleted?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось запустить импорт");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-2xl border border-sky-100 bg-sky-50 p-4 lg:grid-cols-[1.2fr_repeat(4,minmax(0,1fr))_auto]">
      <label className="relative text-xs font-bold text-slate-600">Город или место
        <input
          required
          value={city}
          onFocus={() => setShowSuggestions(true)}
          onChange={(event) => void handleCityChange(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          placeholder="Начните вводить город"
        />
        {isGeocoding ? <span className="absolute right-3 top-9 text-[10px] font-normal text-sky-600">Определяем…</span> : null}
        {showSuggestions && suggestions.length > 0 ? (
          <div className="absolute left-0 top-full z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {suggestions.map((suggestion, index) => (
              <button
                key={`${suggestion.address}-${index}`}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  void selectSuggestion(suggestion);
                }}
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm font-normal hover:bg-sky-50"
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
                <span>{suggestion.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </label>
      <label className="text-xs font-bold text-slate-600">Широта<input required type="text" inputMode="decimal" value={lat} onChange={(event) => { setLat(event.target.value); notifyCoordinates(event.target.value, lon); }} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
      <label className="text-xs font-bold text-slate-600">Долгота<input required type="text" inputMode="decimal" value={lon} onChange={(event) => { setLon(event.target.value); notifyCoordinates(lat, event.target.value); }} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
      <label className="text-xs font-bold text-slate-600">Радиус, м<input required type="number" min="100" max="50000" value={radius} onChange={(event) => setRadius(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
      <label className="text-xs font-bold text-slate-600">Ключевое слово<select value={keyword} onChange={(event) => setKeyword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">{keywords[target].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <button type="submit" disabled={loading || !token} className="flex items-center justify-center gap-2 self-end rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Запустить</button>
    </form>
  );
}
