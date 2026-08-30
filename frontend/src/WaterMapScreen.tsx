import { useEffect, useMemo, useRef, useState } from "react";
import { Droplets, List, Map, MapPin, Phone, X } from "lucide-react";

import MapWebGLFallback, {
  load2GisMapSdk,
  tryCreate2GisMap,
} from "./components/MapWebGLFallback";
import SwipeableBottomSheet from "./SwipeableBottomSheet";
import { baseURL, formatPhoneNumber, resolveMediaUrl } from "./utils";

type WaterType = "free" | "paid" | "unknown";

interface WaterPoint {
  id: string;
  water_type: WaterType;
  name?: string | null;
  source: string;
  address: string | null;
  lat: number;
  lon: number;
  phone?: string | null;
  price?: number | null;
  is_free?: boolean;
  price_unit?: string | null;
  description?: string | null;
  primary_image_url?: string | null;
  crm_status: "parsed" | "in_progress" | "agreed" | "hidden";
  is_active: boolean;
  is_ready: boolean;
}

const DEFAULT_CENTER: [number, number] = [65.534328, 57.152286];

const isFreePoint = (point: WaterPoint) =>
  point.is_free === true || point.water_type === "free" || Number(point.price) === 0;

const isPointReady = (point: WaterPoint) => point.crm_status === "agreed";

export default function WaterMapScreen() {
  const [points, setPoints] = useState<WaterPoint[]>([]);
  const [filter, setFilter] = useState<"" | WaterType>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRefs = useRef<any[]>([]);

  const visiblePoints = useMemo(
    () => points.filter((point) => !filter || point.water_type === filter),
    [filter, points],
  );

  const selectedPoint = useMemo(
    () => visiblePoints.find((point) => point.id === selectedId) ?? null,
    [selectedId, visiblePoints],
  );

  useEffect(() => {
    if (selectedId && !visiblePoints.some((point) => point.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, visiblePoints]);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    void fetch(`${baseURL}/water-points/map${filter ? `?water_type=${filter}` : ""}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить точки воды");
        return response.json() as Promise<WaterPoint[]>;
      })
      .then((data) => {
        if (!disposed) setPoints(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!disposed) setPoints([]);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [filter]);

  useEffect(() => {
    let disposed = false;
    const key = import.meta.env.VITE_2GIS_KEY;
    if (!mapContainerRef.current || !key || mapRef.current) {
      if (!key) setMapUnavailable(true);
      return;
    }

    void load2GisMapSdk()
      .then((mapgl) => {
        if (disposed || !mapContainerRef.current || mapRef.current) return;
        const map = tryCreate2GisMap(
          () => new mapgl.Map(mapContainerRef.current, { center: DEFAULT_CENTER, zoom: 10, key }),
          () => setMapUnavailable(true),
        );
        if (!map || disposed) {
          map?.destroy?.();
          return;
        }
        mapRef.current = map;
        setMapReady(true);
      })
      .catch(() => !disposed && setMapUnavailable(true));

    return () => {
      disposed = true;
      markerRefs.current.forEach((marker) => marker.destroy?.());
      markerRefs.current = [];
      mapRef.current?.destroy?.();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const mapgl = (window as any).mapgl;
    if (!mapReady || !mapRef.current || !mapgl?.HtmlMarker) return;

    markerRefs.current.forEach((marker) => marker.destroy?.());
    markerRefs.current = visiblePoints
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon))
      .map((point) => {
        const element = document.createElement("button");
        element.type = "button";
        element.className = `water-map-marker water-map-marker--crm-${point.crm_status}`;
        element.setAttribute("aria-label", point.name || point.source);

        const label = document.createElement("span");
        label.className = "water-map-marker__label";
        label.textContent = point.name || point.source;
        element.appendChild(label);

        const labelTail = document.createElement("span");
        labelTail.className = "water-map-marker__label-tail";
        element.appendChild(labelTail);

        const pin = document.createElement("span");
        pin.className = `water-map-marker__pin water-map-marker__pin--${isPointReady(point) ? point.water_type : "muted"}`;
        pin.textContent = "💧";
        element.appendChild(pin);
        element.addEventListener("click", () => setSelectedId(point.id));

        return new mapgl.HtmlMarker(mapRef.current, {
          coordinates: [point.lon, point.lat],
          html: element,
        });
      });

    const first = visiblePoints[0];
    if (first && Number.isFinite(first.lat) && Number.isFinite(first.lon)) {
      mapRef.current.setCenter?.([first.lon, first.lat]);
      mapRef.current.setZoom?.(11);
    }
  }, [mapReady, visiblePoints]);

  const renderPointSummary = (point: WaterPoint) => (
    <button
      key={point.id}
      type="button"
      onClick={() => setSelectedId(point.id)}
      className="w-full rounded-2xl bg-white p-4 text-left shadow-sm transition hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <span className={`rounded-xl p-2.5 ${point.water_type === "free" ? "bg-sky-100 text-sky-600" : "bg-emerald-100 text-emerald-600"}`}><Droplets className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-black text-slate-900">{point.name || point.source}</h2>
          <p className="mt-1 flex gap-1 text-sm text-slate-600"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" /><span className="line-clamp-2">{point.address || "Адрес не указан — точка задана координатами"}</span></p>
          <p className="mt-2 text-sm font-bold text-emerald-600">{!isPointReady(point) ? "Временно без доставки" : isFreePoint(point) ? "Бесплатно" : `${Number(point.price).toLocaleString("ru-RU")} ₽/${point.price_unit || "ед."}`}</p>
        </div>
      </div>
    </button>
  );

  return (
    <section className="relative flex h-full min-h-[480px] flex-1 overflow-hidden rounded-t-[28px] bg-slate-100 sm:rounded-[28px]">
      <div className="absolute inset-0 bg-slate-100">
        <div ref={mapContainerRef} className="h-full w-full" aria-label="Карта точек воды" />
        {mapUnavailable ? <MapWebGLFallback className="absolute inset-0" /> : null}
      </div>

      {showList ? (
        <div className="absolute inset-0 z-[5] overflow-y-auto bg-slate-100 px-4 pb-6 pt-44">
          <div className="space-y-3">{visiblePoints.map(renderPointSummary)}</div>
        </div>
      ) : null}

      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 pt-[max(env(safe-area-inset-top),0px)]">
        <div className={`pointer-events-auto bg-white/95 backdrop-blur ${showList ? "m-0 w-full rounded-none border-b border-gray-200 px-4 py-3 shadow-sm" : "m-4 rounded-xl p-4 shadow-lg"}`}>
        <div className="flex items-center gap-3">
          <span className="rounded-2xl bg-sky-100 p-3 text-sky-600"><Droplets /></span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-black text-slate-900">{showList ? "Список воды" : "Карта воды"}</h1>
              <p className="text-sm text-slate-500">{showList ? "Выберите точку воды из списка" : "Выберите каплю на карте"}</p>
          </div>
          <button
            type="button"
            onClick={() => { setShowList((current) => !current); setSelectedId(null); }}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-sky-500 px-3 py-2 text-sm font-bold text-white"
          >
            {showList ? <Map className="h-4 w-4" /> : <List className="h-4 w-4" />}
            {showList ? "На карте" : "Списком"}
          </button>
        </div>
        <div className="mt-4 flex gap-2" role="group" aria-label="Фильтр типа воды">
          {(["", "free", "paid"] as const).map((value) => (
            <button
              key={value || "all"}
              type="button"
              onClick={() => { setFilter(value); setSelectedId(null); }}
              className={`rounded-full px-3 py-2 text-sm font-bold ${filter === value ? "bg-sky-500 text-white" : "bg-white text-slate-700 shadow-sm"}`}
            >
              {value === "" ? "Все" : value === "free" ? "Бесплатная" : "Платная"}
            </button>
          ))}
        </div>
        </div>
      </header>

      {loading ? <div className="pointer-events-none absolute inset-x-4 top-48 z-10 rounded-2xl bg-white p-4 text-sm font-medium text-slate-600 shadow-xl">Загружаем точки воды…</div> : null}
      {!loading && visiblePoints.length === 0 ? <div className="pointer-events-none absolute inset-x-4 top-48 z-10 rounded-2xl bg-white p-4 text-sm font-medium text-slate-600 shadow-xl">Подходящих точек пока нет.</div> : null}

      <SwipeableBottomSheet
        isOpen={Boolean(selectedPoint)}
        onClose={() => setSelectedId(null)}
        containerClassName="pointer-events-none absolute inset-0 z-20 flex items-end justify-center"
        sheetClassName="pointer-events-auto max-h-[85vh] w-full max-w-md overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:mb-4 sm:rounded-2xl"
        showOverlay={false}
      >
        {selectedPoint ? (
          <div className="hide-scrollbar max-h-[72dvh] overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex items-start justify-between gap-3 pb-4">
              <div className={`min-w-0 ${isPointReady(selectedPoint) ? "" : "water-map-card--muted"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-black text-slate-900">{selectedPoint.name || selectedPoint.source}</h2>
                  {isPointReady(selectedPoint) ? <span className={`rounded-full px-3 py-1 text-xs font-bold ${isFreePoint(selectedPoint) ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"}`}>
                    {isFreePoint(selectedPoint) ? "Бесплатно" : "Платная вода"}
                  </span> : null}
                </div>
                <p className="mt-1 text-sm text-slate-500">Источник: {selectedPoint.source}</p>
              </div>
              <button type="button" onClick={() => setSelectedId(null)} className="shrink-0 rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200 hover:text-slate-700" aria-label="Закрыть детали точки воды">
                <X className="h-5 w-5" />
              </button>
            </div>

            {!isPointReady(selectedPoint) ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="font-black text-slate-900">Временно без доставки</p>
                  <p className="mt-1 text-sm text-slate-600">Точка ещё не готова принимать заказы.</p>
                </div>
              </div>
            ) : <>
            <div className="overflow-hidden rounded-2xl bg-slate-100">
              {selectedPoint.primary_image_url ? (
                <img src={resolveMediaUrl(selectedPoint.primary_image_url)} alt={selectedPoint.name || selectedPoint.source} className="aspect-[16/9] w-full object-cover" />
              ) : (
                <div className="grid aspect-[16/9] place-items-center text-sky-300"><Droplets className="h-14 w-14" /></div>
              )}
            </div>

            <div className="mt-4 space-y-3">
            <p className="flex gap-2 text-sm leading-relaxed text-slate-600"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />{selectedPoint.address || "Адрес не указан — точка задана координатами"}</p>
              {isFreePoint(selectedPoint) ? <p className="text-lg font-black text-emerald-600">Бесплатно</p> : selectedPoint.price !== null && selectedPoint.price !== undefined ? <p className="text-lg font-black text-slate-900">{Number(selectedPoint.price).toLocaleString("ru-RU")} ₽/{selectedPoint.price_unit || "ед."}</p> : null}
              {selectedPoint.description ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{selectedPoint.description}</p> : null}
              {selectedPoint.phone ? <a className="flex items-center gap-2 rounded-2xl bg-sky-50 px-4 py-3 text-sm font-bold text-sky-700" href={`tel:${selectedPoint.phone}`}><Phone className="h-4 w-4" />{formatPhoneNumber(selectedPoint.phone)}</a> : null}
            </div>
            </>}
          </div>
        ) : null}
      </SwipeableBottomSheet>
    </section>
  );
}
