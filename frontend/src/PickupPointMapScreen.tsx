import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, MapPin, Mountain, Warehouse } from "lucide-react";
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
  const [points, setPoints] = useState<PickupPointMarker[]>([]);
  const [selected, setSelected] = useState<PickupPointSelection | null>(null);
  const [filter, setFilter] = useState<"all" | "quarry" | "accumulator">("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      element.className = "pickup-point-marker";
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
      element.addEventListener("click", () => void openPoint(point));

      return new mapgl.HtmlMarker(mapRef.current, {
        coordinates: [point.lon, point.lat],
        html: element,
      });
    });
  }, [points, filter]);

  const openPoint = async (point: PickupPointMarker) => {
    mapRef.current?.setCenter([point.lon, point.lat]);
    try {
      const response = await fetch(
        `${baseURL}/catalog/pickup-points/${point.id}?material_id=${material.id}`,
      );
      if (!response.ok) throw new Error("Точка больше недоступна");
      const detail = await response.json();
      const offer = detail.material_offers?.find((item: any) => item.material_id === material.id);
      setSelected({ ...point, ...detail, price: Number(offer?.price ?? point.price) });
    } catch (reason: any) {
      setError(reason.message);
    }
  };

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

      {selected && (
        <div className="absolute bottom-0 inset-x-0 bg-white rounded-t-[28px] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl">
          <div className="flex gap-4">
            <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gray-100 text-gray-400">
              {selected.primary_image_url ? (
                <img src={selected.primary_image_url} alt="" className="w-full h-full object-cover" />
              ) : selected.point_type === "quarry" ? <Mountain /> : <Warehouse />}
            </div>
            <div className="min-w-0">
              <span className="text-xs font-bold uppercase tracking-wide text-sky-500">{TYPE_LABELS[selected.point_type]}</span>
              <h2 className="truncate text-xl font-bold text-gray-900">{selected.name}</h2>
              <p className="line-clamp-2 text-sm text-gray-500">{selected.address}</p>
            </div>
          </div>
          <div className="my-4 rounded-xl bg-gray-50 p-3">
            <span className="block text-xs text-gray-500">Материал</span>
            <strong className="text-gray-900">{Number(selected.price).toLocaleString("ru-RU")} ₽/{selected.unit}</strong>
          </div>
          <button onClick={() => onSelect(selected)} className="w-full rounded-xl bg-sky-500 py-4 font-bold text-white hover:bg-sky-600">
            Выбрать точку
          </button>
        </div>
      )}
    </div>
  );
}
