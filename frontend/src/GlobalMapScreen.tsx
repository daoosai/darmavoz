import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, Mountain, Phone, Route, Warehouse, X } from "lucide-react";

import { handleOpenNavigator } from "./openNavigator";
import { baseURL, formatPhoneNumber, resolveMediaUrl } from "./utils";

interface GlobalPickupPointMaterial {
  material_id: string;
  material_name: string;
  unit: string;
  price?: number | null;
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
}

const DEFAULT_MAP_CENTER: [number, number] = [65.534328, 57.152286];

const TYPE_LABELS: Record<GlobalPickupPoint["point_type"], string> = {
  quarry: "Карьер",
  accumulator: "Накопитель",
  warehouse: "Склад",
  supplier: "Поставщик",
};

export default function GlobalMapScreen() {
  const [points, setPoints] = useState<GlobalPickupPoint[]>([]);
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<GlobalPickupPoint | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const pointMarkerRefs = useRef<any[]>([]);
  const userMarkerRef = useRef<any | null>(null);
  const userLocationCenteredRef = useRef(false);

  const clearSelectedPoint = () => setSelectedPoint(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`${baseURL}/catalog/pickup-points/global`);
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
  }, []);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      return;
    }

    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (cancelled) {
          return;
        }

        const lat = Number(coords.latitude);
        const lon = Number(coords.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          setUserLocation({ lat, lon });
        }
      },
      () => undefined,
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );

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
    const mapgl = (window as any).mapgl;
    const key = import.meta.env.VITE_2GIS_KEY;

    if (!mapContainerRef.current || !mapgl || !key || mapRef.current) {
      return;
    }

    mapRef.current = new mapgl.Map(mapContainerRef.current, {
      center: DEFAULT_MAP_CENTER,
      zoom: 10,
      key,
    });

    return () => {
      pointMarkerRefs.current.forEach((marker) => marker.destroy());
      pointMarkerRefs.current = [];
      userMarkerRef.current?.destroy?.();
      userMarkerRef.current = null;
      mapRef.current?.destroy();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const mapgl = (window as any).mapgl;
    if (!mapRef.current || !mapgl?.HtmlMarker) {
      return;
    }

    pointMarkerRefs.current.forEach((marker) => marker.destroy());
    pointMarkerRefs.current = [];

    pointMarkerRefs.current = visiblePoints.map((point) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = `global-pickup-marker${point.id === selectedPoint?.id ? " global-pickup-marker--active" : ""}`;
      element.innerHTML =
        point.point_type === "quarry"
          ? '<span class="global-pickup-marker__icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 19 6.4-11 3.2 5.2L15.4 9 21 19H3Z"/><path d="m7.5 19 3.1-5.3 3.2 5.3H7.5Z" opacity=".45"/></svg></span>'
          : '<span class="global-pickup-marker__icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5 12 5l8 4.5V19h-3v-6H7v6H4V9.5Z"/><path d="M9 15h6v4H9v-4Z" opacity=".45"/></svg></span>';
      element.addEventListener("click", () => setSelectedPoint(point));

      return new mapgl.HtmlMarker(mapRef.current, {
        coordinates: [point.lon, point.lat],
        html: element,
      });
    });
  }, [selectedPoint?.id, visiblePoints]);

  useEffect(() => {
    const mapgl = (window as any).mapgl;
    if (!mapRef.current || !mapgl?.HtmlMarker) {
      return;
    }

    userMarkerRef.current?.destroy?.();
    userMarkerRef.current = null;

    if (!userLocation) {
      return;
    }

    const element = document.createElement("div");
    element.className = "global-user-marker";
    element.setAttribute("aria-label", "Вы здесь");

    userMarkerRef.current = new mapgl.HtmlMarker(mapRef.current, {
      coordinates: [userLocation.lon, userLocation.lat],
      html: element,
    });
  }, [userLocation]);

  useEffect(() => {
    if (!userLocation || !mapRef.current || userLocationCenteredRef.current || selectedPoint) {
      return;
    }

    mapRef.current.setCenter([userLocation.lon, userLocation.lat], {
      easing: "easeOutCubic",
      duration: 700,
    });
    mapRef.current.setZoom(12, {
      easing: "easeOutCubic",
      duration: 700,
    });
    userLocationCenteredRef.current = true;
  }, [selectedPoint, userLocation]);

  useEffect(() => {
    if (!selectedPoint || !mapRef.current) {
      return;
    }

    mapRef.current.setCenter([selectedPoint.lon, selectedPoint.lat], {
      easing: "easeOutCubic",
      duration: 600,
    });
    mapRef.current.setZoom(12, {
      easing: "easeOutCubic",
      duration: 600,
    });
  }, [selectedPoint]);

  const toggleMaterial = (materialId: string) => {
    setSelectedMaterials((current) =>
      current.includes(materialId)
        ? current.filter((value) => value !== materialId)
        : [...current, materialId],
    );
  };

  return (
    <div className="relative min-h-[calc(100vh-140px)] overflow-hidden rounded-[28px] bg-slate-100">
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
        .global-pickup-marker--active {
          background: #0ea5e9;
          color: #ffffff;
          transform: scale(1.06);
        }
        .global-pickup-marker__icon {
          width: 20px;
          height: 20px;
          display: inline-flex;
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

      <div ref={mapContainerRef} className="absolute inset-0" />

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
          <div className="absolute inset-x-0 bottom-0 z-20 px-4 pb-[env(safe-area-inset-bottom,16px)]">
            <div className="relative flex max-h-[80dvh] flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:rounded-[28px]">
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
                  <h3 className="text-xl font-black text-slate-900">{selectedPoint.name}</h3>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-sky-700">
                      {TYPE_LABELS[selectedPoint.point_type]}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{selectedPoint.address}</p>
                </div>
              </div>

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
                      <p className="text-sm leading-6 text-slate-600">{selectedPoint.description}</p>
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

              <div className="shrink-0 border-t border-slate-100 bg-white px-4 pb-[env(safe-area-inset-bottom,16px)] pt-3">
                <button
                  type="button"
                  onClick={() =>
                    handleOpenNavigator({
                      lat: selectedPoint.lat,
                      lon: selectedPoint.lon,
                      label: selectedPoint.short_name || selectedPoint.name,
                      address: selectedPoint.address,
                    })
                  }
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 px-5 py-4 font-bold text-white shadow-sm"
                >
                  <Route className="h-5 w-5" />
                  Построить маршрут
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
