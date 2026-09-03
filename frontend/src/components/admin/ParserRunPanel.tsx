import { useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
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

type ParserPreviewItem = { twogis_id: string; name: string; address: string; lat: number; lon: number; phone?: string | null; parsed_data: Record<string, unknown>; is_update: boolean };
type ParserPreviewResult = {
  items: ParserPreviewItem[];
  skipped_items: { name: string; reason: string; count?: number }[];
  truncated: boolean;
};

const TARGET_RUBRIC_KEYWORDS = [
  "песок", "щебень", "грунт", "пгс", "щпс", "отсев", "чернозём",
  "торф", "керамзит", "асфальт", "вода", "септик", "неруд", "сыпуч",
];

const textValues = (value: unknown): string[] => {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []);
};

const getRubrics = (parsedData: Record<string, unknown>) => {
  const rubrics = parsedData.rubrics;
  if (!Array.isArray(rubrics)) return [];
  return [...new Set(rubrics.flatMap((rubric) => {
    if (typeof rubric === "string" && rubric.trim()) return [rubric.trim()];
    if (rubric && typeof rubric === "object" && "name" in rubric && typeof rubric.name === "string" && rubric.name.trim()) {
      return [rubric.name.trim()];
    }
    return [];
  }))];
};

const getDisplayedRubrics = (parsedData: Record<string, unknown>) => {
  const rubrics = getRubrics(parsedData);
  const targetRubrics = rubrics.filter((rubric) => {
    const normalizedRubric = rubric.toLocaleLowerCase("ru-RU");
    return TARGET_RUBRIC_KEYWORDS.some((keyword) => normalizedRubric.includes(keyword));
  });
  const displayedRubrics = targetRubrics.length > 0 ? targetRubrics : rubrics.slice(0, 2);
  const isFallbackTruncated = targetRubrics.length === 0 && rubrics.length > displayedRubrics.length;

  return {
    fullText: displayedRubrics.join(", "),
    text: `${displayedRubrics.join(", ")}${isFallbackTruncated ? "..." : ""}`,
  };
};

const getWebsiteDomain = (website: string) => {
  const normalized = website.includes("://") ? website : `https://${website}`;
  try {
    return new URL(normalized).hostname.replace(/^www\./i, "");
  } catch {
    return website.replace(/^https?:\/\//i, "").split(/[/?#]/, 1)[0];
  }
};

const getPreviewDetails = (item: ParserPreviewItem) => {
  const phone = item.phone?.trim() || textValues(item.parsed_data.phones)[0];
  const website = textValues(item.parsed_data.websites)[0]
    || textValues(item.parsed_data.website)[0]
    || textValues(item.parsed_data.site)[0];
  return {
    rubrics: getDisplayedRubrics(item.parsed_data),
    phone,
    website: website ? getWebsiteDomain(website) : null,
  };
};

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
  const [radius, setRadius] = useState("50000");
  const [keyword, setKeyword] = useState("песок");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [parserResult, setParserResult] = useState<ParserPreviewResult | null>(null);
  const [selectedPreviewIds, setSelectedPreviewIds] = useState<Set<string>>(new Set());
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);
  const suggestionRequestRef = useRef(0);
  const skippedItemsCount = parserResult?.skipped_items.reduce((total, item) => total + (item.count || 1), 0) || 0;

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
    event.stopPropagation();
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
      const result = await response.json() as ParserPreviewResult;
      setParserResult(result);
      setSelectedPreviewIds(new Set(result.items.map((item) => item.twogis_id)));
      setIsResultModalOpen(true);
      toast.success("Парсинг завершен");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось запустить импорт");
    } finally {
      setLoading(false);
    }
  };

  const closeResultModal = () => {
    setIsResultModalOpen(false);
    setParserResult(null);
    void onCompleted?.();
  };

  const saveSelected = async () => {
    if (!token || !parserResult) return;
    const items = parserResult.items.filter((item) => selectedPreviewIds.has(item.twogis_id));
    if (items.length === 0) return;
    setLoading(true);
    try {
      const response = await fetch(`${baseURL}/admin/parser/save`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ city, center_lat: parseCoordinate(lat), center_lon: parseCoordinate(lon), radius_m: Number(radius), target, keyword, items }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось сохранить точки"));
      toast.success(`Сохранено: ${data.created + data.updated}`);
      closeResultModal();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось сохранить точки"); }
    finally { setLoading(false); }
  };

  return (
    <>
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
      <label className="text-xs font-bold text-slate-600">Ключевое слово
        <input required type="text" list={`parser-keywords-${target}`} value={keyword} onChange={(event) => setKeyword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
        <datalist id={`parser-keywords-${target}`}>{keywords[target].map((value) => <option key={value} value={value} />)}</datalist>
      </label>
      <button type="submit" disabled={loading || !token} className="flex items-center justify-center gap-2 self-end rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Запустить</button>
      </form>
      {isResultModalOpen && parserResult ? (
        createPortal(
          <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-900/50 p-4 pt-[max(env(safe-area-inset-top),2.5rem)]">
            <section role="dialog" aria-modal="true" aria-labelledby="parser-result-title" className="max-h-full w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 p-5">
              <div>
                <h2 id="parser-result-title" className="text-lg font-bold text-slate-900">Результаты парсинга</h2>
                <p className="mt-1 text-sm text-slate-500">Найдено: {parserResult.items.length}{parserResult.truncated ? ". Достигнут лимит выдачи" : ""}</p>
              </div>
              <button type="button" onClick={closeResultModal} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Закрыть</button>
            </div>
            <div className="max-h-[65vh] space-y-3 overflow-y-auto p-5">
              <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={parserResult.items.length > 0 && selectedPreviewIds.size === parserResult.items.length} onChange={() => setSelectedPreviewIds((current) => current.size === parserResult.items.length ? new Set() : new Set(parserResult.items.map((item) => item.twogis_id)))} />Выбрать всё</label>
              {parserResult.items.map((item) => {
                const details = getPreviewDetails(item);
                return (
                  <label key={item.twogis_id} className="flex gap-3 rounded-xl bg-slate-50 p-3 text-sm">
                    <input type="checkbox" checked={selectedPreviewIds.has(item.twogis_id)} onChange={() => setSelectedPreviewIds((current) => { const next = new Set(current); next.has(item.twogis_id) ? next.delete(item.twogis_id) : next.add(item.twogis_id); return next; })} />
                    <span className="min-w-0">
                      <strong>{item.name}</strong>
                      <span className="block text-slate-500">{item.address}</span>
                      {details.rubrics.text ? <span title={details.rubrics.fullText} className="block truncate text-xs text-gray-500">Рубрики: {details.rubrics.text}</span> : null}
                      {details.phone ? <span className="block text-xs text-gray-500">Телефон: {details.phone}</span> : null}
                      {details.website ? <span className="block text-xs text-gray-500">Сайт: {details.website}</span> : null}
                    </span>
                  </label>
                );
              })}
              {parserResult.skipped_items.length > 0 ? (
                <section className="rounded-xl border border-red-100 bg-red-50 p-3" aria-label="Пропущенные объекты">
                  <h3 className="text-sm font-bold text-red-700">❌ Пропущено ({skippedItemsCount})</h3>
                  <ul className="mt-2 space-y-1 text-sm text-red-600">
                    {parserResult.skipped_items.map((item, index) => <li key={`${item.name}-${item.reason}-${index}`}><strong>{item.name}</strong>{(item.count || 1) > 1 ? ` (${item.count} филиалов)` : ""} — Причина: {item.reason}</li>)}
                  </ul>
                </section>
              ) : null}
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-100 p-5"><button type="button" onClick={closeResultModal} className="rounded-xl bg-slate-100 px-4 py-2 font-bold text-slate-700">Отмена</button><button type="button" disabled={loading || selectedPreviewIds.size === 0} onClick={() => void saveSelected()} className="rounded-xl bg-sky-600 px-4 py-2 font-bold text-white disabled:opacity-50">Добавить выбранные ({selectedPreviewIds.size})</button></div>
            </section>
          </div>,
          document.body,
        )
      ) : null}
    </>
  );
}
