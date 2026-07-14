import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Loader2,
  MapPin,
  Mountain,
  Warehouse,
} from "lucide-react";
import { baseURL } from "./utils";
import { MaterialProps } from "./MaterialDetailScreen";

export interface PickupPointMarker {
  id: string;
  name: string;
  short_name: string;
  point_type: "quarry" | "accumulator" | "warehouse" | "supplier";
  lat: number;
  lon: number;
  material_id: string;
  price: number;
  unit: string;
  min_delivery_price: number;
  primary_image_url?: string | null;
}

export interface PickupPointSelection extends PickupPointMarker {
  address: string;
  description?: string | null;
  delivery_options: any[];
  media_files?: { id: string; public_url: string }[];
}

interface Props {
  material: MaterialProps;
  onClose: () => void;
  onSelect: (point: PickupPointSelection) => void;
}

interface UserLocation {
  lat: number;
  lon: number;
}

export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const earthRadiusKm = 6371;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(lat2 - lat1);
  const longitudeDelta = toRadians(lon2 - lon1);
  const startLatitude = toRadians(lat1);
  const endLatitude = toRadians(lat2);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(startLatitude)
      * Math.cos(endLatitude)
      * Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function getMinDeliveryPrice(point: PickupPointMarker) {
  const configuredPrice = Number(point.min_delivery_price);
  if (configuredPrice > 0) return configuredPrice;
  return point.point_type === "accumulator" ? 3000 : 5000;
}

const TYPE_LABELS: Record<string, string> = {
  quarry: "Карьер",
  accumulator: "Накопитель",
  warehouse: "Склад",
  supplier: "Поставщик",
};

export default function PickupPointMapScreen({ material, onClose, onSelect }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRefs = useRef<any[]>([]);
  const carouselRef = useRef<HTMLDivElement>(null);
  const carouselFrameRef = useRef<number | null>(null);
  const pointCardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const detailsAbortRef = useRef<AbortController | null>(null);
  const [points, setPoints] = useState<PickupPointMarker[]>([]);
  const [selected, setSelected] = useState<PickupPointSelection | null>(null);
  const [filter, setFilter] = useState<"all" | "quarry" | "accumulator">("all");
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [isLocationResolved, setIsLocationResolved] = useState(false);
  const [activePointId, setActivePointId] = useState<string | null>(null);
  const [detailsLoadingId, setDetailsLoadingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const carouselPoints = points
    .filter((point) => filter === "all" || point.point_type === filter)
    .map((point) => ({
      point,
      distance: userLocation
        ? calculateDistance(userLocation.lat, userLocation.lon, point.lat, point.lon)
        : null,
    }));

  if (userLocation) {
    carouselPoints.sort((first, second) => (first.distance ?? 0) - (second.distance ?? 0));
  }

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setIsLocationResolved(true);
      return;
    }

    let mounted = true;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (mounted) {
          setUserLocation({ lat: coords.latitude, lon: coords.longitude });
          setIsLocationResolved(true);
        }
      },
      () => {
        // The map remains usable when location access is unavailable or denied.
        if (mounted) setIsLocationResolved(true);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetch(`${baseURL}/catalog/pickup-points?material_id=${material.id}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить точки забора");
        return response.json();
      })
      .then((data) => {
        if (!cancelled) setPoints(Array.isArray(data) ? data : []);
      })
      .catch((reason) => !cancelled && setError(reason.message))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [material.id]);

  useEffect(() => {
    const mapgl = (window as any).mapgl;
    const key = import.meta.env.VITE_2GIS_KEY;
    if (!mapContainerRef.current || !mapgl || !key || mapRef.current) {
      if (!key) setError("Ключ карты 2ГИС не настроен");
      return;
    }
    mapRef.current = new mapgl.Map(mapContainerRef.current, {
      center: [65.527202, 57.152223],
      zoom: 10,
      key,
    });
    return () => {
      markerRefs.current.forEach((marker) => marker.destroy());
      markerRefs.current = [];
      mapRef.current?.destroy();
      mapRef.current = null;
      detailsAbortRef.current?.abort();
      if (carouselFrameRef.current !== null) {
        cancelAnimationFrame(carouselFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const mapgl = (window as any).mapgl;
    if (!mapRef.current || !mapgl) return;
    if (!mapgl.HtmlMarker) {
      setError("Кастомные маркеры карты недоступны");
      return;
    }
    markerRefs.current.forEach((marker) => marker.destroy());
    markerRefs.current = [];
    const visible = points.filter((point) => filter === "all" || point.point_type === filter);
    markerRefs.current = visible.map((point) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = `pickup-point-marker${point.id === activePointId ? " pickup-point-marker--active" : ""}`;
      element.setAttribute("aria-label", `Выбрать точку ${point.short_name || point.name}`);

      const icon = document.createElement("span");
      icon.className = "pickup-point-marker__icon";
      icon.innerHTML = point.point_type === "quarry"
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 19 6.4-11 3.2 5.2L15.4 9 21 19H3Z"/><path d="m7.5 19 3.1-5.3 3.2 5.3H7.5Z" opacity=".45"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5 12 5l8 4.5V19h-3v-6H7v6H4V9.5Z"/><path d="M9 15h6v4H9v-4Z" opacity=".45"/></svg>';

      const content = document.createElement("span");
      content.className = "pickup-point-marker__content";
      const title = document.createElement("span");
      title.className = "pickup-point-marker__title";
      title.textContent = point.short_name || point.name;
      const price = document.createElement("strong");
      price.className = "pickup-point-marker__price";
      price.textContent = `${Number(point.price).toLocaleString("ru-RU")} ₽/${point.unit}`;
      content.append(title, price);
      element.append(icon, content);
      element.addEventListener("click", () => activatePoint(point, true, true));

      return new mapgl.HtmlMarker(mapRef.current, {
        coordinates: [point.lon, point.lat],
        html: element,
      });
    });
  }, [points, filter, activePointId]);

  const activatePoint = (
    point: PickupPointMarker,
    zoom = false,
    scrollCard = false,
  ) => {
    setActivePointId(point.id);
    mapRef.current?.setCenter([point.lon, point.lat], {
      easing: "easeOutCubic",
      duration: 700,
    });
    if (zoom) {
      mapRef.current?.setZoom(13, {
        easing: "easeOutCubic",
        useHeightForAnimation: true,
        duration: 700,
      });
    }
    if (scrollCard) {
      pointCardRefs.current.get(point.id)?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  };

  const openPointDetails = async (point: PickupPointMarker) => {
    activatePoint(point, true, true);
    detailsAbortRef.current?.abort();
    const controller = new AbortController();
    detailsAbortRef.current = controller;
    setDetailsLoadingId(point.id);
    try {
      const response = await fetch(
        `${baseURL}/catalog/pickup-points/${point.id}?material_id=${material.id}`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error("Точка больше недоступна");
      const detail = await response.json();
      const offer = detail.material_offers?.find((item: any) => item.material_id === material.id);
      setSelected({ ...point, ...detail, price: Number(offer?.price ?? point.price) });
    } catch (reason: any) {
      if (reason.name !== "AbortError") setError(reason.message);
    } finally {
      if (detailsAbortRef.current === controller) {
        detailsAbortRef.current = null;
        setDetailsLoadingId(null);
      }
    }
  };

  const handleCarouselScroll = () => {
    if (carouselFrameRef.current !== null) {
      cancelAnimationFrame(carouselFrameRef.current);
    }
    carouselFrameRef.current = requestAnimationFrame(() => {
      carouselFrameRef.current = null;
      const container = carouselRef.current;
      if (!container) return;
      const containerCenter = container.getBoundingClientRect().left + container.clientWidth / 2;
      let closestPointId: string | null = null;
      let closestDistance = Number.POSITIVE_INFINITY;

      pointCardRefs.current.forEach((card, pointId) => {
        const bounds = card.getBoundingClientRect();
        const distanceFromCenter = Math.abs(bounds.left + bounds.width / 2 - containerCenter);
        if (distanceFromCenter < closestDistance) {
          closestDistance = distanceFromCenter;
          closestPointId = pointId;
        }
      });

      if (closestPointId && closestPointId !== activePointId) {
        const entry = carouselPoints.find(({ point }) => point.id === closestPointId);
        if (entry) activatePoint(entry.point);
      }
    });
  };

  const scrollCarousel = (direction: -1 | 1) => {
    const container = carouselRef.current;
    if (!container) return;
    container.scrollBy({
      left: direction * Math.max(260, container.clientWidth * 0.72),
      behavior: "smooth",
    });
  };

  useEffect(() => {
    if (!isLocationResolved || carouselPoints.length === 0) return;
    if (carouselPoints.some(({ point }) => point.id === activePointId)) return;
    activatePoint(carouselPoints[0].point);
  }, [activePointId, filter, isLocationResolved, points, userLocation]);

  return (
    <div className="fixed inset-0 z-[90] overflow-hidden bg-gray-50 sm:mx-auto sm:max-w-md sm:rounded-[32px]">
      <div ref={mapContainerRef} className="absolute inset-0" />
      <header className="absolute top-0 inset-x-0 p-4 pt-[max(1rem,env(safe-area-inset-top))] pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          <button onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full bg-white text-gray-900 shadow-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 rounded-2xl bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
            <p className="text-xs uppercase tracking-[0.16em] text-gray-500">Точки забора</p>
            <h1 className="truncate font-bold text-gray-900">{material.name}</h1>
          </div>
        </div>
        <div className="mt-3 flex gap-2 pointer-events-auto">
          {(["all", "quarry", "accumulator"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold shadow transition-colors ${filter === value ? "bg-sky-500 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
            >
              {value === "all" ? "Все" : TYPE_LABELS[value]}
            </button>
          ))}
        </div>
      </header>

      {(isLoading || error || (!isLoading && points.length === 0)) && (
        <div className="absolute inset-x-4 top-36 bg-white rounded-2xl shadow-xl p-4 flex items-center gap-3">
          {isLoading ? <Loader2 className="animate-spin" /> : <MapPin />}
          <span className="text-sm font-medium">{isLoading ? "Загружаем точки…" : error || "Для материала пока нет точек"}</span>
        </div>
      )}

      {!selected && !isLoading && !error && carouselPoints.length > 0 && (
        <div className="fixed bottom-4 left-0 right-0 z-[100] sm:left-1/2 sm:right-auto sm:w-full sm:max-w-md sm:-translate-x-1/2">
          <button
            type="button"
            aria-label="Предыдущая точка"
            onClick={() => scrollCarousel(-1)}
            className="absolute left-1 top-1/2 z-20 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/80 text-gray-700 shadow-lg backdrop-blur hover:bg-white sm:grid"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div
            ref={carouselRef}
            onScroll={handleCarouselScroll}
            className="hide-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-[calc(50%_-_140px)] py-3"
          >
            {carouselPoints.map(({ point, distance }) => (
              <article
                key={point.id}
                ref={(element) => {
                  if (element) pointCardRefs.current.set(point.id, element);
                  else pointCardRefs.current.delete(point.id);
                }}
                data-point-id={point.id}
                onClick={() => activatePoint(point, true, true)}
                className={`flex w-[280px] shrink-0 snap-center cursor-pointer gap-3 rounded-2xl border bg-white p-3 text-left shadow-xl transition ${activePointId === point.id ? "border-sky-500 ring-2 ring-sky-200" : "border-gray-100 hover:border-sky-200"}`}
              >
                <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-xl bg-gray-100 text-gray-400">
                  {point.primary_image_url ? (
                    <img src={point.primary_image_url} alt="" className="h-full w-full object-cover" />
                  ) : point.point_type === "quarry" ? (
                    <Mountain className="h-7 w-7" />
                  ) : (
                    <Warehouse className="h-7 w-7" />
                  )}
                </div>
                <div className="min-w-0 flex-1 py-0.5">
                  <h2 className="truncate font-bold text-gray-900">{point.short_name || point.name}</h2>
                  <p className="mt-1 text-sm font-bold text-sky-500">
                    {Number(point.price).toLocaleString("ru-RU")} ₽/{point.unit}
                  </p>
                  {distance !== null && (
                    <p className="mt-1 text-xs text-gray-500">
                      ~ {distance < 10 ? distance.toFixed(1) : Math.round(distance)} км от вас
                    </p>
                  )}
                  <p className="mt-1 text-xs font-medium text-gray-600">
                    Доставка от: {getMinDeliveryPrice(point).toLocaleString("ru-RU")} ₽
                  </p>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void openPointDetails(point);
                    }}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-sky-600 hover:text-sky-700"
                  >
                    {detailsLoadingId === point.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronUp className="h-3.5 w-3.5" />}
                    Подробнее
                  </button>
                </div>
              </article>
            ))}
          </div>
          <button
            type="button"
            aria-label="Следующая точка"
            onClick={() => scrollCarousel(1)}
            className="absolute right-1 top-1/2 z-20 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/80 text-gray-700 shadow-lg backdrop-blur hover:bg-white sm:grid"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      )}

      {selected && (
        <div className="pickup-point-sheet absolute bottom-0 inset-x-0 z-[110] max-h-[72vh] overflow-y-auto bg-white rounded-t-[28px] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl">
          <button
            type="button"
            aria-label="Свернуть подробности"
            onClick={() => setSelected(null)}
            className="mx-auto mb-3 grid h-8 w-12 place-items-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200"
          >
            <ChevronDown className="h-5 w-5" />
          </button>
          <div className="flex gap-4">
            <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gray-100 text-gray-400">
              {selected.primary_image_url ? (
                <img src={selected.primary_image_url} alt="" className="w-full h-full object-cover" />
              ) : selected.point_type === "quarry" ? <Mountain /> : <Warehouse />}
            </div>
            <div className="min-w-0">
              <span className="text-xs font-bold uppercase tracking-wide text-sky-500">{TYPE_LABELS[selected.point_type]}</span>
              <h2 className="truncate text-xl font-bold text-gray-900">{selected.name}</h2>
              <p className="mt-1 text-sm text-gray-500">{selected.address || "Адрес не указан"}</p>
            </div>
          </div>
          <div className="my-4 space-y-3 rounded-xl bg-gray-50 p-4">
            <div>
              <span className="block text-xs text-gray-500">Описание</span>
              <p className="mt-1 text-sm text-gray-900">{selected.description || "Описание пока не добавлено"}</p>
            </div>
            <div>
              <span className="block text-xs text-gray-500">Точный адрес</span>
              <p className="mt-1 text-sm font-medium text-gray-900">{selected.address || "Ориентируйтесь по точке на карте"}</p>
            </div>
            <div className="flex items-end justify-between gap-3 border-t border-gray-200 pt-3">
              <div>
                <span className="block text-xs text-gray-500">Материал</span>
                <strong className="text-gray-900">{Number(selected.price).toLocaleString("ru-RU")} ₽/{selected.unit}</strong>
              </div>
              <span className="text-right text-sm font-semibold text-gray-700">
                Доставка от {getMinDeliveryPrice(selected).toLocaleString("ru-RU")} ₽
              </span>
            </div>
          </div>
          <button onClick={() => onSelect(selected)} className="w-full rounded-xl bg-sky-500 py-4 font-bold text-white hover:bg-sky-600">
            Выбрать точку
          </button>
        </div>
      )}
    </div>
  );
}
