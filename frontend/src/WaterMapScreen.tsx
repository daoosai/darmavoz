import { useEffect, useMemo, useRef, useState } from "react";
import { Droplets, MapPin, Phone } from "lucide-react";

import MapWebGLFallback, {
  load2GisMapSdk,
  tryCreate2GisMap,
} from "./components/MapWebGLFallback";
import { baseURL, resolveMediaUrl } from "./utils";

type WaterType = "free" | "paid";

interface WaterPoint {
  id: string;
  water_type: WaterType;
  name?: string | null;
  source: string;
  address: string;
  lat: number;
  lon: number;
  phone?: string | null;
  price?: number | null;
  price_unit?: string | null;
  description?: string | null;
  primary_image_url?: string | null;
}

const DEFAULT_CENTER: [number, number] = [65.534328, 57.152286];

export default function WaterMapScreen() {
  const [points, setPoints] = useState<WaterPoint[]>([]);
  const [filter, setFilter] = useState<"" | WaterType>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
    let disposed = false;
    setLoading(true);
    void fetch(`${baseURL}/water-points${filter ? `?water_type=${filter}` : ""}`)
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
        element.className = "water-map-marker";
        element.setAttribute("aria-label", point.name || point.source);

        const label = document.createElement("span");
        label.className = "water-map-marker__label";
        label.textContent = point.name || point.source;
        element.appendChild(label);

        const pin = document.createElement("span");
        pin.className = `water-map-marker__pin water-map-marker__pin--${point.water_type}`;
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
  }, [mapReady, selectedId, visiblePoints]);

  return (
    <section className="min-h-full bg-slate-50 pb-24">
      <header className="px-4 pb-3 pt-5">
        <div className="flex items-center gap-3">
          <span className="rounded-2xl bg-sky-100 p-3 text-sky-600"><Droplets /></span>
          <div>
            <h1 className="text-xl font-black text-slate-900">Карта воды</h1>
            <p className="text-sm text-slate-500">Точки воды без корзины и расчёта доставки</p>
          </div>
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
      </header>

      <div className="relative h-[46vh] min-h-[280px] bg-slate-100">
        <div ref={mapContainerRef} className="h-full w-full" aria-label="Карта точек воды" />
        {mapUnavailable ? <MapWebGLFallback className="absolute inset-0" /> : null}
      </div>

      <div className="space-y-3 p-4">
        {loading ? <p className="text-sm text-slate-500">Загружаем точки воды…</p> : null}
        {!loading && visiblePoints.length === 0 ? <p className="rounded-2xl bg-white p-4 text-sm text-slate-500">Подходящих точек пока нет.</p> : null}
        {visiblePoints.map((point) => (
          <article
            key={point.id}
            onClick={() => setSelectedId(point.id)}
            className={`overflow-hidden rounded-3xl bg-white shadow-sm ring-2 transition ${selectedPoint?.id === point.id ? "ring-sky-400" : "ring-transparent"}`}
          >
            {point.primary_image_url ? <img src={resolveMediaUrl(point.primary_image_url)} alt={point.name || point.source} className="h-40 w-full object-cover" /> : null}
            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-black text-slate-900">{point.name || point.source}</h2>
                  <p className="text-sm text-slate-500">Источник: {point.source}</p>
                </div>
                <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${point.water_type === "free" ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"}`}>
                  {point.water_type === "free" ? "Бесплатно" : `${point.price} ₽/${point.price_unit}`}
                </span>
              </div>
              <p className="mt-3 flex gap-2 text-sm text-slate-600"><MapPin className="h-4 w-4 shrink-0" />{point.address}</p>
              {point.description ? <p className="mt-2 text-sm text-slate-600">{point.description}</p> : null}
              {point.phone ? <a className="mt-3 flex items-center gap-2 text-sm font-bold text-sky-600" href={`tel:${point.phone}`} onClick={(event) => event.stopPropagation()}><Phone className="h-4 w-4" />{point.phone}</a> : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
