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
import ClientAddressBottomSheet from "./ClientAddressBottomSheet";
import { baseURL, formatPhoneNumber } from "./utils";
import { MaterialProps } from "./MaterialDetailScreen";
import { useAddressStore } from "./store";

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
  contact_phone?: string | null;
  delivery_options: any[];
  material_offers?: {
    material_id: string;
    material_name: string;
    price: number | null;
    unit: string;
    is_active: boolean;
  }[];
  media_files?: { id: string; public_url: string }[];
}

interface Props {
  material: MaterialProps;
  onClose: () => void;
  onSelect: (point: PickupPointSelection) => void;
  deliveryLocation?: UserLocation | null;
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

function getClientFacingAddress(address: string | null | undefined) {
  const normalizedAddress = address?.trim();
  if (!normalizedAddress || /^по координатам\s*:/i.test(normalizedAddress)) {
    return null;
  }
  return normalizedAddress;
}

function formatDistance(distance: number) {
  return distance < 10 ? distance.toFixed(1) : Math.round(distance).toString();
}

const TYPE_LABELS: Record<string, string> = {
  quarry: "Карьер",
  accumulator: "Накопитель",
  warehouse: "Склад",
  supplier: "Поставщик",
};

const getSelectPointButtonLabel = (pointType?: string) => {
  if (pointType === "quarry") return "Выбрать карьер";
  if (pointType === "warehouse" || pointType === "accumulator") {
    return "Выбрать накопитель";
  }
  return "Выбрать точку";
};

export default function PickupPointMapScreen({
  material,
  onClose,
  onSelect,
  deliveryLocation,
}: Props) {
  const { selectedAddress: currentDeliveryAddress } = useAddressStore();
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
  const [isExpanded, setIsExpanded] = useState(false);
  const [isAddressSheetOpen, setIsAddressSheetOpen] = useState(false);
  const [selectedDeliveryLocation, setSelectedDeliveryLocation] = useState<UserLocation | null>(
    deliveryLocation || null,
  );
  const hasDeliveryAddress = Boolean(currentDeliveryAddress.trim());
  const distanceLocation = deliveryLocation || selectedDeliveryLocation || userLocation;

  useEffect(() => {
    if (deliveryLocation) {
      setSelectedDeliveryLocation(deliveryLocation);
    }
  }, [deliveryLocation]);

  useEffect(() => {
    setIsAddressSheetOpen(!hasDeliveryAddress);
  }, [hasDeliveryAddress]);

  const carouselPoints = points
    .filter((point) => filter === "all" || point.point_type === filter)
    .map((point) => ({
      point,
      distance: distanceLocation
        ? calculateDistance(distanceLocation.lat, distanceLocation.lon, point.lat, point.lon)
        : null,
    }));

  if (distanceLocation) {
    carouselPoints.sort((first, second) => (first.distance ?? 0) - (second.distance ?? 0));
  }

  const selectedMediaImages = selected?.media_files
    ?.map((media) => media.public_url)
    .filter(Boolean) || [];
  const selectedImageUrls = Array.from(new Set(
    selectedMediaImages.length > 0
      ? selectedMediaImages
      : selected?.primary_image_url
        ? [selected.primary_image_url]
        : [],
  ));
  const selectedPointAddress = getClientFacingAddress(selected?.address);
  const selectedPhone = selected?.contact_phone?.trim() || "";
  const selectedMaterialOffers = (selected?.material_offers || []).filter(
    (offer) => offer.is_active !== false,
  );
  const visibleMaterialOffers = isExpanded
    ? selectedMaterialOffers
    : selectedMaterialOffers.slice(0, 4);
  const selectedDistance = selected && distanceLocation
    ? calculateDistance(distanceLocation.lat, distanceLocation.lon, selected.lat, selected.lon)
    : null;
  useEffect(() => {
    if (deliveryLocation) {
      setIsLocationResolved(true);
      return;
    }
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
  }, [deliveryLocation]);

  useEffect(() => {
    if (deliveryLocation) return;
    if (!currentDeliveryAddress.trim()) {
      setSelectedDeliveryLocation(null);
      return;
    }

    let cancelled = false;
    fetch(
      `${baseURL}/geo/geocode?address=${encodeURIComponent(currentDeliveryAddress)}`,
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось определить координаты адреса");
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        const lat = Number(data?.lat);
        const lon = Number(data?.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          setSelectedDeliveryLocation({ lat, lon });
        }
      })
      .catch(() => {
        if (!cancelled) setSelectedDeliveryLocation(null);
      });

    return () => {
      cancelled = true;
    };
  }, [deliveryLocation, currentDeliveryAddress]);

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
      element.addEventListener("click", () => void openPointDetails(point));

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
    setIsExpanded(false);
    activatePoint(point, true, true);
    setSelected({
      ...point,
      address: "",
      description: null,
      delivery_options: [],
      media_files: [],
    });
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
  }, [activePointId, filter, isLocationResolved, points, userLocation, selectedDeliveryLocation]);

  return (
    <div className="fixed inset-0 z-[90] overflow-hidden bg-gray-50 sm:mx-auto sm:max-w-md sm:rounded-[32px]">
      <div ref={mapContainerRef} className="absolute inset-0" />
      <header className="absolute top-0 inset-x-0 p-4 pt-[max(1rem,env(safe-area-inset-top))] pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          <button onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full bg-white text-gray-900 shadow-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 rounded-2xl bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
            <p className="text-xs uppercase tracking-[0.16em] text-gray-500">Материал</p>
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
        <div className="fixed bottom-4 left-0 right-0 z-[100] flex flex-col gap-3 sm:left-1/2 sm:right-auto sm:w-full sm:max-w-md sm:-translate-x-1/2">
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
                onClick={() => void openPointDetails(point)}
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
          <div className="px-4 sm:px-0">
            <button
              type="button"
              onClick={() => setIsAddressSheetOpen(true)}
              className="flex w-full items-center gap-3 rounded-2xl bg-white/95 px-4 py-3 text-left shadow-xl backdrop-blur"
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sky-50 text-sky-600">
                <MapPin className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  Адрес доставки
                </p>
                <p className="truncate text-sm font-semibold text-slate-800">
                  {currentDeliveryAddress || "Укажите адрес доставки"}
                </p>
              </div>
            </button>
          </div>
        </div>
      )}

      {selected && (
        <div className="pickup-point-sheet hide-scrollbar absolute bottom-0 inset-x-0 z-[110] max-h-[72vh] overflow-y-auto bg-white rounded-t-[28px] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            aria-label="Свернуть подробности"
            onClick={() => setSelected(null)}
            className="mx-auto mb-3 grid h-8 w-12 place-items-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200"
          >
            <ChevronDown className="h-5 w-5" />
          </button>
          <div className="relative overflow-hidden rounded-2xl bg-gray-100">
            {selectedImageUrls.length > 0 ? (
              <div className="hide-scrollbar flex snap-x snap-mandatory overflow-x-auto">
                {selectedImageUrls.map((imageUrl, index) => (
                  <img
                    key={imageUrl}
                    src={imageUrl}
                    alt={`${selected.name}, фотография ${index + 1}`}
                    className="aspect-[16/9] w-full shrink-0 snap-center object-cover"
                  />
                ))}
              </div>
            ) : (
              <div className="grid aspect-[16/9] place-items-center text-gray-400">
                {selected.point_type === "quarry" ? <Mountain className="h-12 w-12" /> : <Warehouse className="h-12 w-12" />}
              </div>
            )}
            {selectedImageUrls.length > 1 && (
              <span className="absolute bottom-3 right-3 rounded-full bg-slate-900/70 px-2.5 py-1 text-xs font-bold text-white">
                {selectedImageUrls.length} фото
              </span>
            )}
          </div>
          <div className="mt-4 min-w-0">
            <span className="text-xs font-bold uppercase tracking-wide text-sky-500">{TYPE_LABELS[selected.point_type]}</span>
            <h2 className="text-xl font-bold text-gray-900">{selected.name}</h2>
            {selectedPointAddress && <p className="mt-1 text-sm text-gray-500">{selectedPointAddress}</p>}
            {selectedDistance !== null && (
              <p className="mt-1 flex items-center gap-1 text-xs font-medium text-gray-400">
                <MapPin className="h-3.5 w-3.5" />
                Примерно {formatDistance(selectedDistance)} км от вас
              </p>
            )}
          </div>
          <div className="my-4 space-y-3 rounded-xl bg-gray-50 p-4">
            <div>
              <span className="block text-xs text-gray-500">Описание</span>
              <p className="mt-1 text-sm text-gray-900">{selected.description || "Описание пока не добавлено"}</p>
            </div>
            <div className="border-t border-gray-200 pt-3">
              <span className="block text-xs text-gray-500">Контактный телефон</span>
              {selectedPhone ? (
                <div className="mt-2 flex items-center justify-between gap-3">
                  <strong className="text-gray-900">{formatPhoneNumber(selectedPhone)}</strong>
                  <a
                    href={`tel:${selectedPhone}`}
                    className="inline-flex items-center rounded-full bg-white px-3 py-2 text-xs font-bold text-sky-600 shadow-sm hover:bg-sky-50"
                  >
                    Позвонить
                  </a>
                </div>
              ) : (
                <p className="mt-2 text-sm text-gray-400">Номер отсутствует</p>
              )}
            </div>
            <div className="border-t border-gray-200 pt-3">
              <span className="block text-xs text-gray-500">Материал</span>
              <strong className="text-gray-900">
                {material.name} {" — "} {Number(selected.price).toLocaleString("ru-RU")} {"₽"}/{selected.unit}
              </strong>
            </div>
          </div>
          <div className="border-t border-gray-200 pt-3">
            <span className="block text-xs text-gray-500">Доступные материалы</span>
            <div className="mt-2 flex flex-col gap-2">
              {selectedMaterialOffers.length > 0 ? (
                visibleMaterialOffers.map((offer) => (
                  <div
                    key={offer.material_id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2"
                  >
                    <span className="min-w-0 text-sm font-medium text-gray-700">
                      {offer.material_name}
                    </span>
                    <strong className="shrink-0 text-sm text-gray-900">
                      {offer.price !== null
                        ? `${Number(offer.price).toLocaleString("ru-RU")} \u20BD/${offer.unit}`
                        : "Цена не указана"}
                    </strong>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500">Материалы для точки пока не настроены.</p>
              )}
            </div>
            {selectedMaterialOffers.length > 4 && !isExpanded ? (
              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                className="mt-3 text-sm font-semibold text-sky-600 transition-colors hover:text-sky-700"
              >
                {"\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u0431\u043e\u043b\u044c\u0448\u0435"}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onSelect(selected)}
            className="mt-4 w-full rounded-xl bg-sky-500 py-4 text-base font-bold text-white hover:bg-sky-600"
          >
            {getSelectPointButtonLabel(selected.point_type)}
          </button>
        </div>
      )}

      <ClientAddressBottomSheet
        isOpen={isAddressSheetOpen}
        onClose={() => {
          if (hasDeliveryAddress) setIsAddressSheetOpen(false);
        }}
        dismissible={hasDeliveryAddress}
        closeOnSelect
        overlayZIndexClassName="z-[120]"
        sheetZIndexClassName="z-[130]"
        onAddressConfirmed={({ address, lat, lon }) => {
          if (lat != null && lon != null) {
            setSelectedDeliveryLocation({ lat, lon });
          } else if (address.trim()) {
            void fetch(
              `${baseURL}/geo/geocode?address=${encodeURIComponent(address)}`,
            )
              .then(async (response) => {
                if (!response.ok) throw new Error("geocode");
                return response.json();
              })
              .then((data) => {
                const resolvedLat = Number(data?.lat);
                const resolvedLon = Number(data?.lon);
                if (Number.isFinite(resolvedLat) && Number.isFinite(resolvedLon)) {
                  setSelectedDeliveryLocation({ lat: resolvedLat, lon: resolvedLon });
                }
              })
              .catch(() => undefined);
          }
          setIsAddressSheetOpen(false);
        }}
      />
    </div>
  );
}
