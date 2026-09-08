import { cityFetch, currentCity } from './cityStore';
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
  crm_status: "auto_added" | "invite_sent" | "response_received" | "interested" | "registered" | "registration_completed" | "activated" | "refused" | "call_later";
  is_active: boolean;
  is_ready: boolean;
}

interface SepticProfile {
  id: string;
  phone: string;
  address: string;
  lat: number;
  lon: number;
  tank_volume_m3: number | string;
  service_price: number | string;
  primary_image_url?: string | null;
  media_files?: { id: string; public_url: string; is_primary?: boolean }[];
}

type ServiceTab = "water" | "septic";

const DEFAULT_CENTER = (): [number, number] => [currentCity().center_lon, currentCity().center_lat];

const isFreePoint = (point: WaterPoint) =>
  point.is_free === true || point.water_type === "free" || Number(point.price) === 0;

const isPointReady = (point: WaterPoint) => point.crm_status === "activated";

export default function WaterMapScreen({ initialTab = "water" }: { initialTab?: ServiceTab }) {
  const [points, setPoints] = useState<WaterPoint[]>([]);
  const [septicProfiles, setSepticProfiles] = useState<SepticProfile[]>([]);
  const [serviceTab, setServiceTab] = useState<ServiceTab>(initialTab);
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

  const selectedSeptic = useMemo(
    () => septicProfiles.find((profile) => profile.id === selectedId) ?? null,
    [selectedId, septicProfiles],
  );

  useEffect(() => {
    setServiceTab(initialTab);
    setSelectedId(null);
    setShowList(false);
  }, [initialTab]);

  useEffect(() => {
    const selectedItems = serviceTab === "water" ? visiblePoints : septicProfiles;
    if (selectedId && !selectedItems.some((point) => point.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, serviceTab, septicProfiles, visiblePoints]);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    const endpoint = serviceTab === "water"
      ? `${baseURL}/water-points/map${filter ? `?water_type=${filter}` : ""}`
      : `${baseURL}/septic-providers`;
    void cityFetch(endpoint, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить точки на карте");
        return response.json() as Promise<WaterPoint[] | SepticProfile[]>;
      })
      .then((data) => {
        if (disposed) return;
        if (serviceTab === "water") setPoints(Array.isArray(data) ? data as WaterPoint[] : []);
        else setSepticProfiles(Array.isArray(data) ? data as SepticProfile[] : []);
      })
      .catch(() => {
        if (!disposed) {
          if (serviceTab === "water") setPoints([]);
          else setSepticProfiles([]);
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [filter, serviceTab]);

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
          () => new mapgl.Map(mapContainerRef.current, { center: DEFAULT_CENTER(), zoom: currentCity().map_zoom, key }),
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
    if (serviceTab === "septic") {
      markerRefs.current = septicProfiles
        .filter((profile) => Number.isFinite(profile.lat) && Number.isFinite(profile.lon))
        .map((profile) => {
          const element = document.createElement("button");
          element.type = "button";
          element.className = "water-map-marker";
          element.setAttribute("aria-label", "Откачка септика");

          const label = document.createElement("span");
          label.className = "water-map-marker__label";
          label.textContent = `Откачка · ${Number(profile.tank_volume_m3).toLocaleString("ru-RU")} м³`;
          element.appendChild(label);

          const labelTail = document.createElement("span");
          labelTail.className = "water-map-marker__label-tail";
          element.appendChild(labelTail);

          const pin = document.createElement("span");
          pin.className = "water-map-marker__pin water-map-marker__pin--septic";
          pin.textContent = "🚛";
          element.appendChild(pin);
          element.addEventListener("click", () => setSelectedId(profile.id));

          return new mapgl.HtmlMarker(mapRef.current, {
            coordinates: [profile.lon, profile.lat],
            html: element,
          });
        });

      const first = septicProfiles.find((profile) => Number.isFinite(profile.lat) && Number.isFinite(profile.lon));
      if (first) {
        mapRef.current.setCenter?.([first.lon, first.lat]);
        mapRef.current.setZoom?.(11);
      }
      return;
    }

    markerRefs.current = visiblePoints
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon))
      .map((point) => {
        const element = document.createElement("button");
        element.type = "button";
        element.className = `water-map-marker water-map-marker--crm-${isPointReady(point) ? "activated" : "muted"}`;
        element.setAttribute("aria-label", point.name || point.source);

        const label = document.createElement("span");
        label.className = "water-map-marker__label";
        label.textContent = point.name || point.source;
        element.appendChild(label);

        const labelTail = document.createElement("span");
        labelTail.className = "water-map-marker__label-tail";
        element.appendChild(labelTail);

        const pin = document.createElement("span");
        pin.className = `water-map-marker__pin water-map-marker__pin--${isPointReady(point) ? "activated" : "muted"}`;
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
  }, [mapReady, septicProfiles, serviceTab, visiblePoints]);

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

  const renderSepticSummary = (profile: SepticProfile) => {
    const primaryImage = profile.primary_image_url || profile.media_files?.find((media) => media.is_primary)?.public_url;
    return <button key={profile.id} type="button" onClick={() => setSelectedId(profile.id)} className="w-full overflow-hidden rounded-2xl bg-white text-left shadow-sm transition hover:shadow-md"><div className="flex gap-3 p-3">{primaryImage ? <img src={resolveMediaUrl(primaryImage)} alt="" className="h-20 w-24 shrink-0 rounded-xl object-cover" /> : <div className="grid h-20 w-24 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-300"><Droplets className="h-7 w-7" /></div>}<div className="min-w-0 flex-1"><h2 className="font-black text-slate-900">Откачка септика</h2><p className="mt-1 flex gap-1 text-sm text-slate-600"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" /><span className="line-clamp-2">{profile.address}</span></p><p className="mt-1 text-sm font-bold text-sky-600">{Number(profile.service_price).toLocaleString("ru-RU")} ₽</p></div></div></button>;
  };

  return (
    <section className="relative flex h-full min-h-[480px] flex-1 overflow-hidden rounded-t-[28px] bg-slate-100 sm:rounded-[28px]">
      <div className="absolute inset-0 bg-slate-100">
        <div ref={mapContainerRef} className="h-full w-full" aria-label="Карта точек воды" />
        {mapUnavailable ? <MapWebGLFallback className="absolute inset-0" /> : null}
      </div>

      {showList ? (
        <div className="absolute inset-0 z-[5] overflow-y-auto bg-slate-100 px-4 pb-6 pt-44">
          <div className="space-y-3">{serviceTab === "water" ? visiblePoints.map(renderPointSummary) : septicProfiles.map(renderSepticSummary)}</div>
        </div>
      ) : null}

      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 pt-[max(env(safe-area-inset-top),0px)]">
        <div className={`pointer-events-auto bg-white/95 backdrop-blur ${showList ? "m-0 w-full rounded-none border-b border-gray-200 px-4 py-3 shadow-sm" : "m-4 rounded-xl p-4 shadow-lg"}`}>
        <div className="flex items-center gap-3">
          <span className="rounded-2xl bg-sky-100 p-3 text-sky-600"><Droplets /></span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-black text-slate-900">Вода и Септики</h1>
              <p className="text-sm text-slate-500">{showList ? "Выберите предложение из списка" : "Выберите метку на карте"}</p>
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
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Тип точек на карте">
          <button type="button" role="tab" aria-selected={serviceTab === "water"} onClick={() => { setServiceTab("water"); setSelectedId(null); setShowList(false); }} className={`rounded-lg px-3 py-2 text-sm font-bold transition ${serviceTab === "water" ? "bg-white text-sky-600 shadow-sm" : "text-slate-500"}`}>Точки воды</button>
          <button type="button" role="tab" aria-selected={serviceTab === "septic"} onClick={() => { setServiceTab("septic"); setSelectedId(null); setShowList(false); }} className={`rounded-lg px-3 py-2 text-sm font-bold transition ${serviceTab === "septic" ? "bg-white text-sky-600 shadow-sm" : "text-slate-500"}`}>Откачка септиков</button>
        </div>
        {serviceTab === "water" ? <div className="mt-3 flex gap-2" role="group" aria-label="Фильтр типа воды">
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
        </div> : null}
        </div>
      </header>

      {loading ? <div className="pointer-events-none absolute inset-x-4 top-48 z-10 rounded-2xl bg-white p-4 text-sm font-medium text-slate-600 shadow-xl">Загружаем {serviceTab === "water" ? "точки воды" : "услуги откачки"}…</div> : null}
      {!loading && (serviceTab === "water" ? visiblePoints.length : septicProfiles.length) === 0 ? <div className="pointer-events-none absolute inset-x-4 top-48 z-10 rounded-2xl bg-white p-4 text-sm font-medium text-slate-600 shadow-xl">{serviceTab === "water" ? "Подходящих точек пока нет." : "Одобренных предложений пока нет."}</div> : null}

      <SwipeableBottomSheet
        isOpen={serviceTab === "water" && Boolean(selectedPoint)}
        onClose={() => setSelectedId(null)}
        containerClassName="pointer-events-none absolute inset-0 z-[9999] flex items-end justify-center"
        sheetClassName="pointer-events-auto z-[9999] max-h-[70vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:mb-4 sm:rounded-2xl"
        showOverlay={false}
      >
        {selectedPoint ? (
          <div className="hide-scrollbar max-h-[70vh] overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
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

      <SwipeableBottomSheet
        isOpen={serviceTab === "septic" && Boolean(selectedSeptic)}
        onClose={() => setSelectedId(null)}
        containerClassName="pointer-events-none absolute inset-0 z-[9999] flex items-end justify-center"
        sheetClassName="pointer-events-auto z-[9999] max-h-[70vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:mb-4 sm:rounded-2xl"
        showOverlay={false}
      >
        {selectedSeptic ? <div className="hide-scrollbar max-h-[70vh] overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"><div className="flex items-start justify-between gap-3 pb-4"><div><p className="text-xs font-bold uppercase tracking-wide text-sky-600">Услуга</p><h2 className="mt-1 text-xl font-black text-slate-900">Откачка септика</h2></div><button type="button" onClick={() => setSelectedId(null)} className="shrink-0 rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200" aria-label="Закрыть детали септика"><X className="h-5 w-5" /></button></div>{selectedSeptic.primary_image_url ? <div className="overflow-hidden rounded-2xl bg-slate-100"><img src={resolveMediaUrl(selectedSeptic.primary_image_url)} alt={`Откачка септика: ${selectedSeptic.address}`} className="aspect-[16/9] w-full object-cover" /></div> : null}<div className="mt-4 space-y-3"><p className="flex gap-2 text-sm leading-relaxed text-slate-600"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />{selectedSeptic.address}</p><div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-4 text-sm"><p><span className="block text-xs text-slate-400">Объём цистерны</span><strong className="mt-1 block text-slate-800">{Number(selectedSeptic.tank_volume_m3).toLocaleString("ru-RU")} м³</strong></p><p><span className="block text-xs text-slate-400">Стоимость услуги</span><strong className="mt-1 block text-slate-800">{Number(selectedSeptic.service_price).toLocaleString("ru-RU")} ₽</strong></p></div>{selectedSeptic.phone ? <a href={`tel:${selectedSeptic.phone.replace(/[^+\d]/g, "")}`} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 px-5 py-4 text-base font-black text-white shadow-sm transition hover:bg-sky-600"><Phone className="h-5 w-5" />Позвонить</a> : null}</div></div> : null}
      </SwipeableBottomSheet>
    </section>
  );
}
