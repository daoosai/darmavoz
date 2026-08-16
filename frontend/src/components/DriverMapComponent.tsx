import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, MapPin, Phone, Truck, X } from "lucide-react";

import SwipeableBottomSheet from "../SwipeableBottomSheet";
import { useAuthStore } from "../store";
import { baseURL, formatPhoneNumber } from "../utils";
import MapWebGLFallback, {
  load2GisMapSdk,
  tryCreate2GisMap,
} from "./MapWebGLFallback";

type DriverMapStatus = "available" | "busy" | "offline";
type ActiveDriverMapStatus = Exclude<DriverMapStatus, "offline">;

export interface DriverMapItem {
  id: string;
  name: string;
  phone: string;
  is_on_shift: boolean;
  map_status: DriverMapStatus;
  last_lat: number | null;
  last_lon: number | null;
  last_location_updated_at: string | null;
  last_location_is_stale: boolean;
  vehicle_id: string | null;
  vehicle_title: string | null;
  vehicle_plate_number: string | null;
  vehicle_type: string | null;
  vehicle_cubature_min: number | null;
  vehicle_cubature_max: number | null;
  vehicle_tonnage_min: number | null;
  vehicle_tonnage_max: number | null;
}

const DEFAULT_CENTER: [number, number] = [65.534328, 57.152286];
const STALE_LOCATION_MS = 2 * 60 * 1000;
const POLLING_INTERVAL_MS = 15 * 1000;
const activeDriverStatuses: ActiveDriverMapStatus[] = ["available", "busy"];

const statusMeta: Record<DriverMapStatus, { label: string; markerClass: string; badgeClass: string }> = {
  available: {
    label: "Свободен",
    markerClass: "border-emerald-700 bg-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-700",
  },
  busy: {
    label: "Занят",
    markerClass: "border-amber-700 bg-amber-500",
    badgeClass: "bg-amber-100 text-amber-700",
  },
  offline: {
    label: "Недоступен",
    markerClass: "border-slate-500 bg-slate-400",
    badgeClass: "bg-slate-100 text-slate-600",
  },
};

const getMapStatus = (driver: DriverMapItem): DriverMapStatus => {
  const updatedAt = driver.last_location_updated_at
    ? new Date(driver.last_location_updated_at).getTime()
    : Number.NaN;
  const isOutdated = !Number.isFinite(updatedAt) || Date.now() - updatedAt > STALE_LOCATION_MS;

  if (driver.last_location_is_stale || isOutdated || !driver.is_on_shift) {
    return "offline";
  }

  return driver.map_status === "available" || driver.map_status === "busy"
    ? driver.map_status
    : "offline";
};

const formatRange = (min: number | null, max: number | null, unit: string) => {
  if (min != null && max != null) return min === max ? `${min} ${unit}` : `${min}–${max} ${unit}`;
  if (min != null) return `от ${min} ${unit}`;
  if (max != null) return `до ${max} ${unit}`;
  return "Не указана";
};

const formatLocationUpdatedAt = (value: string | null) => {
  if (!value) return "Координаты ещё не получены";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Время обновления неизвестно";

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

export default function DriverMapComponent() {
  const token = useAuthStore((state) => state.token);
  const [drivers, setDrivers] = useState<DriverMapItem[]>([]);
  const [filters, setFilters] = useState<Record<ActiveDriverMapStatus, boolean>>({
    available: true,
    busy: true,
  });
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRefs = useRef<any[]>([]);
  const hasCenteredOnDrivers = useRef(false);

  const activeDrivers = useMemo(
    () => drivers.filter((driver) => getMapStatus(driver) !== "offline"),
    [drivers],
  );

  const visibleDrivers = useMemo(
    () => activeDrivers.filter((driver) => {
      const status = getMapStatus(driver);
      return status !== "offline" && filters[status];
    }),
    [activeDrivers, filters],
  );

  const offlineDrivers = useMemo(
    () => drivers.filter((driver) => getMapStatus(driver) === "offline"),
    [drivers],
  );

  const selectedDriver = useMemo(
    () => visibleDrivers.find((driver) => driver.id === selectedDriverId) ?? null,
    [selectedDriverId, visibleDrivers],
  );

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();

    const refreshDrivers = async () => {
      try {
        if (!token) {
          throw new Error("Требуется авторизация");
        }

        const response = await fetch(`${baseURL}/logist/driver-map`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(response.status === 403 ? "Нет доступа к карте водителей" : "Не удалось загрузить карту водителей");
        }

        const data = await response.json();
        const nextDrivers = Array.isArray(data) ? data : data?.drivers || [];
        if (!disposed) {
          setDrivers(nextDrivers);
          setLoadError(null);
        }
      } catch (error) {
        if (!disposed && (error as Error).name !== "AbortError") {
          setLoadError(error instanceof Error ? error.message : "Не удалось загрузить карту водителей");
        }
      } finally {
        if (!disposed) setIsLoading(false);
      }
    };

    void refreshDrivers();
    const intervalId = window.setInterval(() => void refreshDrivers(), POLLING_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      controller.abort();
    };
  }, [token]);

  useEffect(() => {
    if (selectedDriverId && !selectedDriver) setSelectedDriverId(null);
  }, [selectedDriver, selectedDriverId]);

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
      hasCenteredOnDrivers.current = false;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const mapgl = (window as any).mapgl;
    if (!mapReady || !mapRef.current || !mapgl?.HtmlMarker) return;

    markerRefs.current.forEach((marker) => marker.destroy?.());
    const driversWithCoordinates = visibleDrivers.filter(
      (driver) => Number.isFinite(driver.last_lat) && Number.isFinite(driver.last_lon),
    );

    markerRefs.current = driversWithCoordinates.map((driver) => {
      const status = getMapStatus(driver);
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "flex h-11 w-11 items-center justify-center rounded-full border-2 text-lg text-white shadow-lg transition-transform hover:scale-110 focus:outline-none focus:ring-4 focus:ring-sky-300 " + statusMeta[status].markerClass;
      marker.setAttribute("aria-label", `Водитель ${driver.name}: ${statusMeta[status].label}`);
      marker.textContent = "🚚";
      marker.addEventListener("click", () => setSelectedDriverId(driver.id));

      return new mapgl.HtmlMarker(mapRef.current, {
        coordinates: [Number(driver.last_lon), Number(driver.last_lat)],
        html: marker,
      });
    });

    const firstDriver = driversWithCoordinates[0];
    if (!hasCenteredOnDrivers.current && firstDriver) {
      mapRef.current.setCenter?.([Number(firstDriver.last_lon), Number(firstDriver.last_lat)]);
      mapRef.current.setZoom?.(11);
      hasCenteredOnDrivers.current = true;
    }
  }, [mapReady, visibleDrivers]);

  const toggleFilter = (status: ActiveDriverMapStatus) => {
    setFilters((current) => ({ ...current, [status]: !current[status] }));
  };

  const renderDriverCard = (driver: DriverMapItem, onClose?: () => void) => {
    const status = getMapStatus(driver);
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-black text-slate-900">{driver.name}</h2>
            <a href={`tel:${driver.phone}`} className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-slate-600">
              <Phone className="h-4 w-4 text-sky-600" />
              {formatPhoneNumber(driver.phone)}
            </a>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusMeta[status].badgeClass}`}>
              {statusMeta[status].label}
            </span>
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
                aria-label="Закрыть карточку водителя"
              >
                <X className="h-5 w-5" />
              </button>
            ) : null}
          </div>
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-slate-500">Автомобиль</dt>
          <dd className="font-bold text-slate-800">{driver.vehicle_title || "Не указан"}</dd>
          <dt className="text-slate-500">Госномер</dt>
          <dd className="font-bold text-slate-800">{driver.vehicle_plate_number || "Не указан"}</dd>
          <dt className="text-slate-500">Тип</dt>
          <dd className="font-bold text-slate-800">{driver.vehicle_type || "Не указан"}</dd>
          <dt className="text-slate-500">Кубатура</dt>
          <dd className="font-bold text-slate-800">{formatRange(driver.vehicle_cubature_min, driver.vehicle_cubature_max, "м³")}</dd>
        </dl>

        <div className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          <span>Обновлено: <strong>{formatLocationUpdatedAt(driver.last_location_updated_at)}</strong></span>
        </div>
      </div>
    );
  };

  return (
    <section className="flex min-h-[calc(100dvh-13rem)] flex-1 flex-col gap-4">
      <div className="relative flex min-h-[50vh] flex-1 overflow-hidden rounded-[28px] bg-slate-100 sm:min-h-[560px]">
      <div className="absolute inset-0 bg-slate-100">
        <div ref={mapContainerRef} className="h-full w-full" aria-label="Карта водителей" />
        {mapUnavailable ? <MapWebGLFallback className="absolute inset-0" /> : null}
      </div>

      <header className="pointer-events-none absolute inset-x-0 top-4 z-10 pt-[env(safe-area-inset-top)]">
        <div className="pointer-events-auto mx-3 rounded-2xl border border-white/60 bg-white/85 p-3 shadow-lg backdrop-blur sm:mx-4 sm:max-w-xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="rounded-xl bg-sky-100 p-2 text-sky-600"><MapPin className="h-5 w-5" /></span>
              <div>
                <h1 className="text-lg font-black text-slate-900">Карта водителей</h1>
                <p className="text-xs font-medium text-slate-500">Обновляется каждые 15 секунд</p>
              </div>
            </div>
            <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-slate-500"><Truck className="h-4 w-4" />{activeDrivers.length}</span>
          </div>

          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Фильтр статуса водителей">
            {activeDriverStatuses.map((status) => (
              <label key={status} className="flex cursor-pointer items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm">
                <input
                  type="checkbox"
                  checked={filters[status]}
                  onChange={() => toggleFilter(status)}
                  className="h-4 w-4 accent-sky-600"
                />
                <span className={`h-2.5 w-2.5 rounded-full ${statusMeta[status].markerClass.split(" ").pop()}`} />
                {statusMeta[status].label}
              </label>
            ))}
          </div>

        </div>
      </header>

      {isLoading ? <div className="pointer-events-none absolute inset-x-4 top-56 z-10 rounded-2xl bg-white p-4 text-sm font-semibold text-slate-600 shadow-xl">Загружаем координаты водителей…</div> : null}
      {!isLoading && loadError ? <div className="absolute inset-x-4 top-56 z-10 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700 shadow-xl">{loadError}</div> : null}
      {!isLoading && !loadError && visibleDrivers.length === 0 ? <div className="pointer-events-none absolute inset-x-4 top-56 z-10 rounded-2xl bg-white p-4 text-sm font-semibold text-slate-600 shadow-xl">Подходящих водителей пока нет.</div> : null}

      {selectedDriver ? (
        <aside className="absolute right-4 top-40 z-20 hidden w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl sm:block">
          {renderDriverCard(selectedDriver, () => setSelectedDriverId(null))}
        </aside>
      ) : null}

      <SwipeableBottomSheet
        isOpen={Boolean(selectedDriver)}
        onClose={() => setSelectedDriverId(null)}
        containerClassName="pointer-events-none absolute inset-0 z-20 flex items-end justify-center sm:hidden"
        sheetClassName="pointer-events-auto w-full max-w-md rounded-t-2xl bg-white shadow-2xl"
        showOverlay={false}
      >
        {selectedDriver ? <div className="max-h-[70dvh] overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{renderDriverCard(selectedDriver, () => setSelectedDriverId(null))}</div> : null}
      </SwipeableBottomSheet>
      </div>

      {offlineDrivers.length > 0 ? (
        <section className="max-h-72 shrink-0 overflow-y-auto rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm" aria-label="Водители не в сети или недоступны">
          <h2 className="text-lg font-black text-slate-900">Водители не в сети / недоступны</h2>
          <ul className="mt-3 space-y-2">
            {offlineDrivers.map((driver) => (
              <li key={driver.id} className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-600">
                <p className="truncate font-bold text-slate-900">{driver.name}</p>
                <p className="mt-0.5 truncate">{formatPhoneNumber(driver.phone)}</p>
                <p className="mt-0.5 truncate">{driver.vehicle_title || "Автомобиль не указан"}</p>
                <p className="mt-0.5 truncate">{driver.vehicle_plate_number || "Госномер не указан"}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
