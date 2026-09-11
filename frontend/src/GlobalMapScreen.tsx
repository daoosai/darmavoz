import { cityFetch, cityMapCenter, cityMapZoom, useCityStore } from './cityStore';
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { useEffect, useRef, useState } from "react";
import { Loader2, LocateFixed, MapPin, Mountain, Phone, Route, Warehouse, X } from "lucide-react";
import toast from "react-hot-toast";

import MapWebGLFallback, { load2GisMapSdk, tryCreate2GisMap } from "./components/MapWebGLFallback";
import { handleOpenNavigator } from "./openNavigator";
import { baseURL, formatPhoneNumber, resolveMediaUrl } from "./utils";

interface GlobalPickupPointMaterial {
  material_id: string;
  material_name: string;
  unit: string;
  price?: number | null;
  is_free?: boolean;
}

interface GlobalPickupPoint {
  id: string;
  name: string;
  short_name: string;
  point_type: "quarry" | "accumulator" | "warehouse" | "supplier";
  address: string;
  description?: string | null;
  contact_phone?: string | null;
  lat: number;
  lon: number;
  primary_image_url?: string | null;
  material_offers: GlobalPickupPointMaterial[];
  crm_status: string;
  is_active: boolean;
  is_ready: boolean;
  twogis_id?: string | null;
}

interface UserLocation {
  lat: number;
  lon: number;
}

const TYPE_LABELS: Record<GlobalPickupPoint["point_type"], string> = {
  quarry: "Карьер",
  accumulator: "Накопитель",
  warehouse: "Склад",
  supplier: "Поставщик",
};

const hasOrderableMaterialOffer = (point: GlobalPickupPoint) =>
  point.material_offers.some((offer) => offer.is_free === true || Number(offer.price) > 0);

const isPointReady = (point: GlobalPickupPoint) =>
  (point.crm_status === "activated" || point.crm_status === "agreed")
  && point.is_active
  && hasOrderableMaterialOffer(point);

const getCrmMarkerStatus = (point: GlobalPickupPoint) =>
  isPointReady(point) ? "activated" : "inactive";

export default function GlobalMapScreen({
  isAuthenticated,
  onOpenAuth,
}: {
  isAuthenticated: boolean;
  onOpenAuth: () => void;
}) {
  const cityId = useCityStore((state) => state.cityId);
  const activeCity = useCityStore((state) =>
    state.cities.find((city) => city.id === state.cityId && city.is_active) ?? null,
  );
  const [activeCenterLon, activeCenterLat] = cityMapCenter(activeCity);
  const activeMapZoom = cityMapZoom(activeCity);
  const [points, setPoints] = useState<GlobalPickupPoint[]>([]);
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<GlobalPickupPoint | null>(null);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [isMapUnavailable, setIsMapUnavailable] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const pointMarkerRefs = useRef<any[]>([]);
  const userMarkerRef = useRef<any | null>(null);
  const initialViewportAppliedRef = useRef(false);

  const clearSelectedPoint = () => setSelectedPoint(null);

  const upsertUserMarker = (nextLocation: UserLocation | null) => {
    const mapgl = (window as any).mapgl;
    if (!isMapReady || !mapRef.current || !mapgl?.HtmlMarker) {
      return;
    }

    if (!nextLocation) {
      userMarkerRef.current?.destroy?.();
      userMarkerRef.current = null;
      return;
    }

    const coordinates: [number, number] = [nextLocation.lon, nextLocation.lat];
    if (typeof userMarkerRef.current?.setCoordinates === "function") {
      userMarkerRef.current.setCoordinates(coordinates);
      return;
    }

    userMarkerRef.current?.destroy?.();
    const element = document.createElement("div");
    element.className = "global-user-marker";
    element.setAttribute("aria-label", "Вы здесь");

    userMarkerRef.current = new mapgl.HtmlMarker(mapRef.current, {
      coordinates,
      html: element,
    });
  };

  const centerMapOnCoordinates = (
    location: UserLocation,
    zoom = 14,
  ) => {
    if (!mapRef.current) {
      return;
    }

    mapRef.current.setCenter([location.lon, location.lat], {
      easing: "easeOutCubic",
      duration: 700,
    });
    mapRef.current.setZoom(zoom, {
      easing: "easeOutCubic",
      duration: 700,
    });
  };

  const requestUserLocation = async (showErrorToast = false) => {
    try {
      if (Capacitor.isNativePlatform()) {
        await Geolocation.requestPermissions();
      }

      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 300000,
      });

      const nextLocation = {
        lat: Number(position.coords.latitude),
        lon: Number(position.coords.longitude),
      };
      setUserLocation(nextLocation);
      return nextLocation;
    } catch (locationError) {
      console.warn("Геолокация недоступна или запрещена пользователем", locationError);
      if (showErrorToast) {
        toast.error("Не удалось получить доступ к геопозиции");
      }
      return null;
    }
  };

  const handleLocateMe = async () => {
    const nextLocation = await requestUserLocation(true);
    if (!nextLocation) {
      return;
    }

    upsertUserMarker(nextLocation);
    centerMapOnCoordinates(nextLocation, 14);
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await cityFetch(`${baseURL}/catalog/pickup-points/global`, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("Не удалось загрузить точки на карте");
        }

        const data = await response.json();
        if (!cancelled) {
          setPoints(Array.isArray(data) ? data : []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "Ошибка загрузки карты",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [cityId]);

  useEffect(() => {
    let cancelled = false;

    const resolveInitialUserLocation = async () => {
      const nextLocation = await requestUserLocation(false);
      if (!cancelled && nextLocation) {
        setUserLocation(nextLocation);
      }
    };

    void resolveInitialUserLocation();

    return () => {
      cancelled = true;
    };
  }, []);

  const materials = Array.from(
    points.reduce((materialMap, point) => {
      point.material_offers.forEach((offer) => {
        if (!materialMap.has(offer.material_id)) {
          materialMap.set(offer.material_id, {
            id: offer.material_id,
            name: offer.material_name,
          });
        }
      });
      return materialMap;
    }, new Map<string, { id: string; name: string }>()),
  )
    .map(([, value]) => value)
    .sort((first, second) => first.name.localeCompare(second.name, "ru"));

  const visiblePoints = points.filter((point) => {
    if (selectedMaterials.length === 0) {
      return true;
    }

    return point.material_offers.some((offer) => selectedMaterials.includes(offer.material_id));
  });

  useEffect(() => {
    if (selectedPoint && !visiblePoints.some((point) => point.id === selectedPoint.id)) {
      clearSelectedPoint();
    }
  }, [selectedPoint, visiblePoints]);

  useEffect(() => {
    let disposed = false;
    const key = import.meta.env.VITE_2GIS_KEY;

    if (!mapContainerRef.current || !key || mapRef.current) {
      return;
    }

    void load2GisMapSdk()
      .then((mapgl) => {
        if (disposed || !mapContainerRef.current || mapRef.current) return;
        const mapInstance = tryCreate2GisMap(
          () => new mapgl.Map(mapContainerRef.current, {
            center: [activeCenterLon, activeCenterLat],
            zoom: activeMapZoom,
            key,
          }),
          () => setIsMapUnavailable(true),
        );
        if (!mapInstance) return;
        if (disposed) {
          mapInstance.destroy();
          return;
        }
        mapRef.current = mapInstance;
        setIsMapReady(true);
      })
      .catch(() => !disposed && setIsMapUnavailable(true));

    return () => {
      disposed = true;
      pointMarkerRefs.current.forEach((marker) => marker.destroy());
      pointMarkerRefs.current = [];
      userMarkerRef.current?.destroy?.();
      userMarkerRef.current = null;
      setIsMapReady(false);
      initialViewportAppliedRef.current = false;
      mapRef.current?.destroy();
      mapRef.current = null;
    };
  }, [cityId]);

  useEffect(() => {
    if (!isMapReady || !mapRef.current) return;
    mapRef.current.setCenter?.([activeCenterLon, activeCenterLat], {
      easing: "easeOutCubic",
      duration: 500,
    });
    mapRef.current.setZoom?.(activeMapZoom, {
      easing: "easeOutCubic",
      duration: 500,
    });
    initialViewportAppliedRef.current = false;
  }, [activeCenterLat, activeCenterLon, activeMapZoom, isMapReady]);

  useEffect(() => {
    const mapgl = (window as any).mapgl;
    if (!isMapReady || !mapRef.current || !mapgl?.HtmlMarker) {
      return;
    }

    pointMarkerRefs.current.forEach((marker) => marker.destroy());
    pointMarkerRefs.current = [];

    pointMarkerRefs.current = visiblePoints.map((point) => {
      const markerStatus = getCrmMarkerStatus(point);
      const element = document.createElement("button");
      element.type = "button";
      element.className = `global-pickup-marker global-pickup-marker--${markerStatus}${point.id === selectedPoint?.id ? " global-pickup-marker--selected" : ""}`;
      const label = document.createElement("span");
      label.className = "global-pickup-marker__label";
      label.textContent = point.short_name || point.name;
      element.appendChild(label);
      const labelTail = document.createElement("span");
      labelTail.className = "global-pickup-marker__label-tail";
      element.appendChild(labelTail);
      const icon = document.createElement("span");
      icon.innerHTML =
        point.point_type === "quarry"
          ? '<span class="global-pickup-marker__icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 19 6.4-11 3.2 5.2L15.4 9 21 19H3Z"/><path d="m7.5 19 3.1-5.3 3.2 5.3H7.5Z" opacity=".45"/></svg></span>'
          : '<span class="global-pickup-marker__icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5 12 5l8 4.5V19h-3v-6H7v6H4V9.5Z"/><path d="M9 15h6v4H9v-4Z" opacity=".45"/></svg></span>';
      element.appendChild(icon);
      element.addEventListener("click", () => setSelectedPoint(point));

      return new mapgl.HtmlMarker(mapRef.current, {
        coordinates: [point.lon, point.lat],
        html: element,
      });
    });
  }, [isMapReady, selectedPoint?.id, visiblePoints]);

  useEffect(() => {
    upsertUserMarker(userLocation);
  }, [isMapReady, userLocation]);

  useEffect(() => {
    if (
      !isMapReady ||
      loading ||
      initialViewportAppliedRef.current ||
      selectedPoint
    ) {
      return;
    }

    centerMapOnCoordinates(
      { lat: activeCenterLat, lon: activeCenterLon },
      activeMapZoom,
    );
    initialViewportAppliedRef.current = true;
  }, [activeCenterLat, activeCenterLon, activeMapZoom, isMapReady, loading, selectedPoint]);

  useEffect(() => {
    if (!selectedPoint || !mapRef.current) {
      return;
    }

    centerMapOnCoordinates({ lat: selectedPoint.lat, lon: selectedPoint.lon }, 12);
  }, [selectedPoint]);

  const toggleMaterial = (materialId: string) => {
    setSelectedMaterials((current) =>
      current.includes(materialId)
        ? current.filter((value) => value !== materialId)
        : [...current, materialId],
    );
  };

  return (
    <div className="flex h-full flex-col bg-slate-100">
      <style>{`
        .global-pickup-marker {
          width: 44px;
          height: 44px;
          border: none;
          border-radius: 999px;
          background: #ffffff;
          box-shadow: 0 14px 28px rgba(15, 23, 42, 0.22);
          display: grid;
          place-items: center;
          cursor: pointer;
        }
        .global-pickup-marker--activated {
          background: #16a34a;
          color: #ffffff;
        }
        .global-pickup-marker--inactive {
          background: #94a3b8;
          color: #ffffff;
          opacity: 0.82;
        }
        .global-pickup-marker--selected {
          color: #ffffff;
          transform: scale(1.06);
        }
        .global-pickup-marker__icon {
          width: 20px;
          height: 20px;
          display: inline-flex;
        }
        .global-pickup-marker__label {
          position: absolute; bottom: 48px; max-width: 160px; overflow: hidden;
          white-space: nowrap; text-overflow: ellipsis; border-radius: 8px;
          background: #0ea5e9; color: #fff; padding: 3px 7px;
          font-size: 11px; font-weight: 700; pointer-events: none;
        }
        .global-pickup-marker__label-tail {
          position: absolute; left: 50%; bottom: 42px;
          width: 0; height: 0; transform: translateX(-50%);
          border-left: 6px solid transparent; border-right: 6px solid transparent;
          border-top: 6px solid #0ea5e9;
        }
        .global-pickup-marker__icon svg {
          width: 100%;
          height: 100%;
          fill: currentColor;
        }
        .global-user-marker {
          width: 18px;
          height: 18px;
          border-radius: 999px;
          background: #0ea5e9;
          border: 3px solid #ffffff;
          box-shadow: 0 0 0 6px rgba(14, 165, 233, 0.24);
        }
      `}</style>

      <div className="relative min-h-[480px] flex-1 w-full overflow-hidden rounded-t-[28px] bg-slate-100 sm:rounded-[28px]">
        {isMapUnavailable ? (
          <MapWebGLFallback className="absolute inset-0 h-full w-full" />
        ) : (
          <div ref={mapContainerRef} className="absolute inset-0 h-full w-full flex-1" />
        )}

        {selectedPoint === null && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 p-4">
            <div className="pointer-events-auto rounded-[28px] bg-white/95 p-4 shadow-xl backdrop-blur">
              <h2 className="text-2xl font-black text-slate-900">Активные точки</h2>
              <p className="mt-1 text-sm text-slate-500">
                Все активные карьеры и накопители на одной карте
              </p>
              <div className="mt-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                <button
                  type="button"
                  onClick={() => setSelectedMaterials([])}
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${
                    selectedMaterials.length === 0
                      ? "bg-sky-500 text-white"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  Все материалы
                </button>
                {materials.map((material) => {
                  const isActive = selectedMaterials.includes(material.id);
                  return (
                    <button
                      key={material.id}
                      type="button"
                      onClick={() => toggleMaterial(material.id)}
                      className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${
                        isActive ? "bg-sky-500 text-white" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {material.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => void handleLocateMe()}
          aria-label="Моё местоположение"
          className="absolute bottom-24 right-4 z-[50] flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-lg transition hover:bg-slate-50"
        >
          <LocateFixed className="h-5 w-5 text-sky-600" />
        </button>

        {(loading || error) && (
          <div className="absolute inset-x-4 top-40 z-10 rounded-2xl bg-white p-4 shadow-xl">
            <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <MapPin className="h-5 w-5" />}
              {loading ? "Загружаем точки..." : error}
            </div>
          </div>
        )}

        {!loading && !error && visiblePoints.length === 0 && (
          <div className="absolute inset-x-4 top-40 z-10 rounded-2xl bg-white p-4 text-sm font-medium text-slate-600 shadow-xl">
            Для выбранных материалов активных точек пока нет.
          </div>
        )}

        {selectedPoint && (
          <>
            <button
              type="button"
              aria-label="Закрыть детали точки"
              className="absolute inset-0 z-10 bg-transparent"
              onClick={clearSelectedPoint}
            />
            <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] left-1/2 z-40 w-[calc(100%-2.5rem)] max-w-sm -translate-x-1/2">
              <div className="relative flex max-h-[75dvh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
                <div className="flex shrink-0 items-start gap-3 border-b border-slate-100 px-4 py-4">
                  <button
                    type="button"
                    aria-label="Закрыть детали точки"
                    onClick={clearSelectedPoint}
                    className="rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
                  >
                    <X className="h-5 w-5" />
                  </button>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xl font-black text-slate-900">{selectedPoint.name}</h3>
                      <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-sky-700">
                        {TYPE_LABELS[selectedPoint.point_type]}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{selectedPoint.address}</p>
                  </div>
                </div>

                {!isPointReady(selectedPoint) ? (
                  <div className="flex-1 overflow-y-auto px-4 py-4">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-sm font-bold text-slate-900">Временно нет доставки через Дармавоз</p>
                      <p className="mt-1 text-sm text-slate-600">Точка ещё не готова принимать заказы.</p>
                      {selectedPoint.twogis_id ? (
                        <a
                          href={`https://2gis.ru/firm/${selectedPoint.twogis_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-flex items-center rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700 transition hover:bg-emerald-100"
                        >
                          Посмотреть контакты в 2ГИС ↗
                        </a>
                      ) : null}
                    </div>
                  </div>
                ) : (
                <div className="flex-1 overflow-y-auto px-4 py-4">
                  <div className="grid gap-4 sm:grid-cols-[160px,1fr]">
                    <div className="mt-2 overflow-hidden rounded-2xl bg-slate-100">
                      {selectedPoint.primary_image_url ? (
                        <img
                          src={resolveMediaUrl(selectedPoint.primary_image_url) || "/placeholder.jpg"}
                          alt={selectedPoint.name}
                          className="h-36 w-full rounded-2xl object-cover"
                        />
                      ) : (
                        <div className="flex h-36 items-center justify-center rounded-2xl text-slate-300">
                          {selectedPoint.point_type === "quarry" ? (
                            <Mountain className="h-10 w-10" />
                          ) : (
                            <Warehouse className="h-10 w-10" />
                          )}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0">
                      {selectedPoint.description ? (
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{selectedPoint.description}</p>
                      ) : null}

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl bg-slate-50 p-3">
                          <p className="text-xs font-bold tracking-wide text-slate-400">
                            Материалы
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {selectedPoint.material_offers.map((offer) => (
                              <span
                                key={offer.material_id}
                                className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                              >
                                {offer.material_name}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-2xl bg-slate-50 p-3">
                          <p className="text-xs font-bold tracking-wide text-slate-400">
                            Контакты
                          </p>
                          <p className="mt-2 text-sm font-bold text-slate-800">
                            {selectedPoint.contact_phone
                              ? formatPhoneNumber(selectedPoint.contact_phone)
                              : "Телефон не указан"}
                          </p>
                          {selectedPoint.contact_phone ? (
                            <a
                              href={`tel:${selectedPoint.contact_phone}`}
                              className="mt-3 inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-bold text-sky-700"
                            >
                              <Phone className="h-3.5 w-3.5" />
                              Позвонить
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                )}

                {isPointReady(selectedPoint) ? <div className="shrink-0 border-t border-slate-100 bg-white px-4 pb-4 pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (!isAuthenticated) {
                        onOpenAuth();
                        return;
                      }
                      handleOpenNavigator({
                        lat: selectedPoint.lat,
                        lon: selectedPoint.lon,
                        label: selectedPoint.short_name || selectedPoint.name,
                        address: selectedPoint.address,
                      });
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 px-5 py-4 font-bold text-white shadow-sm"
                  >
                    <Route className="h-5 w-5" />
                    Построить маршрут
                  </button>
                </div> : null}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
