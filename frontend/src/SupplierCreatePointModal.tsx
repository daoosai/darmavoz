import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2, MapPin, Plus, Search, X } from "lucide-react";
import toast from "react-hot-toast";

import { fetch2gisAddressSuggestions, withTyumenBias } from "./addressSearch";
import { baseURL, extractApiErrorMessage } from "./utils";

interface Material {
  id: string;
  name: string;
  unit: string;
}

export interface SupplierPoint {
  id: string;
  point_type: "quarry" | "accumulator" | "warehouse" | "supplier";
  name: string;
  short_name?: string | null;
  address: string;
  description?: string | null;
  lat: number;
  lon: number;
  moderation_status: string;
  moderation_comment?: string | null;
  primary_image_url?: string | null;
  media_files?: Array<{
    id: string;
    public_url: string;
    is_primary?: boolean;
  }>;
  material_offers?: Array<{
    material_id: string;
    price: number;
    is_active: boolean;
  }>;
}

interface Props {
  token: string;
  point?: SupplierPoint | null;
  onClose: () => void;
  onSaved: (point: SupplierPoint) => void;
}

const TYUMEN_CENTER: [number, number] = [65.534328, 57.152286];

const initialForm = {
  point_type: "quarry",
  name: "",
  short_name: "",
  address: "",
  description: "",
  lat: "",
  lon: "",
};

const suggestionLabel = (item: any): string =>
  item.full_name || item.address_name || item.name || item.search_attributes?.suggested_text || "";

export default function SupplierCreatePointModal({ token, point, onClose, onSaved }: Props) {
  const isEditing = Boolean(point);
  const [form, setForm] = useState(() =>
    point
      ? {
          point_type: point.point_type,
          name: point.name,
          short_name: point.short_name || "",
          address: point.address || "",
          description: point.description || "",
          lat: String(point.lat),
          lon: String(point.lon),
        }
      : initialForm,
  );
  const [materials, setMaterials] = useState<Material[]>([]);
  const [offerPrices, setOfferPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (point?.material_offers || [])
        .filter((offer) => offer.is_active)
        .map((offer) => [offer.material_id, String(offer.price)]),
    ),
  );
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const draggedCoordinatesRef = useRef<[number, number] | null>(null);

  useEffect(() => {
    fetch(`${baseURL}/catalog/materials/`)
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => setMaterials(Array.isArray(data) ? data : []))
      .catch(() => toast.error("Не удалось загрузить материалы"));
  }, []);

  useEffect(() => {
    const query = form.address.trim();
    if (query.length < 3) {
      setSuggestions([]);
      return;
    }
    const timeoutId = window.setTimeout(async () => {
      setSuggestions(await fetch2gisAddressSuggestions(query));
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [form.address]);

  useEffect(() => {
    const mapgl = (window as any).mapgl;
    const key = import.meta.env.VITE_2GIS_KEY;
    if (!mapgl || !key || !mapContainerRef.current || mapRef.current) return;

    const map = new mapgl.Map(mapContainerRef.current, {
      center: TYUMEN_CENTER,
      zoom: 12,
      key,
    });
    const marker = new mapgl.Marker(map, { coordinates: TYUMEN_CENTER });
    mapRef.current = map;
    markerRef.current = marker;

    let dragging = false;
    const dragStart = () => {
      dragging = true;
      map.setOption("disableDragging", true);
    };
    const dragMove = (event: MouseEvent | TouchEvent) => {
      if (!dragging) return;
      const pointer = event instanceof MouseEvent ? event : event.changedTouches[0];
      const coordinates = map.unproject([pointer.clientX, pointer.clientY]) as [number, number];
      draggedCoordinatesRef.current = coordinates;
      marker.setCoordinates(coordinates);
    };
    const dragEnd = () => {
      if (!dragging) return;
      dragging = false;
      map.setOption("disableDragging", false);
      const coordinates = draggedCoordinatesRef.current;
      if (coordinates) {
        setForm((current) => ({
          ...current,
          lon: coordinates[0].toFixed(6),
          lat: coordinates[1].toFixed(6),
        }));
      }
    };

    marker.on("mousedown", dragStart);
    marker.on("touchstart", dragStart);
    document.addEventListener("mousemove", dragMove);
    document.addEventListener("touchmove", dragMove);
    document.addEventListener("mouseup", dragEnd);
    document.addEventListener("touchend", dragEnd);

    return () => {
      document.removeEventListener("mousemove", dragMove);
      document.removeEventListener("touchmove", dragMove);
      document.removeEventListener("mouseup", dragEnd);
      document.removeEventListener("touchend", dragEnd);
      marker.destroy();
      map.destroy();
      markerRef.current = null;
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const lat = Number(form.lat);
    const lon = Number(form.lon);
    if (!markerRef.current || !mapRef.current || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const coordinates: [number, number] = [lon, lat];
    markerRef.current.setCoordinates(coordinates);
    mapRef.current.setCenter(coordinates);
  }, [form.lat, form.lon]);

  const geocodeAddress = async (address: string): Promise<[number, number]> => {
    setIsGeocoding(true);
    try {
      const response = await fetch(
        `${baseURL}/geo/geocode?address=${encodeURIComponent(withTyumenBias(address))}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !Number.isFinite(Number(data.lat)) || !Number.isFinite(Number(data.lon))) {
        throw new Error(extractApiErrorMessage(data, "Не удалось определить координаты адреса"));
      }
      return [Number(data.lon), Number(data.lat)];
    } finally {
      setIsGeocoding(false);
    }
  };

  const selectSuggestion = async (item: any) => {
    const address = suggestionLabel(item);
    setForm((current) => ({ ...current, address }));
    setShowSuggestions(false);
    try {
      const itemLat = Number(item.point?.lat);
      const itemLon = Number(item.point?.lon);
      const [lon, lat] = Number.isFinite(itemLat) && Number.isFinite(itemLon)
        ? [itemLon, itemLat]
        : await geocodeAddress(address);
      setForm((current) => ({ ...current, address, lat: lat.toFixed(6), lon: lon.toFixed(6) }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось определить координаты");
    }
  };

  const toggleMaterial = (materialId: string) => {
    setOfferPrices((current) => {
      if (!(materialId in current)) return { ...current, [materialId]: "" };
      const next = { ...current };
      delete next[materialId];
      return next;
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const materialOffers = Object.entries(offerPrices).map(([materialId, price]) => ({
      material_id: materialId,
      price: Number(price),
      is_active: true,
    }));
    if (!materialOffers.length || materialOffers.some((offer) => offer.price <= 0)) {
      toast.error("Выберите хотя бы один материал и укажите цену");
      return;
    }

    let lat = Number(form.lat);
    let lon = Number(form.lon);
    const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lon) && form.lat !== "" && form.lon !== "";
    if (!form.address.trim() && !hasCoordinates) {
      toast.error("Укажите адрес или координаты точки");
      return;
    }

    setIsBusy(true);
    try {
      if (!hasCoordinates) {
        [lon, lat] = await geocodeAddress(form.address);
      }
      const response = await fetch(
        isEditing ? `${baseURL}/supplier/points/${point!.id}` : `${baseURL}/supplier/points`,
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            ...form,
            address: form.address.trim(),
            short_name: form.short_name || null,
            description: form.description || null,
            lat,
            lon,
            material_offers: materialOffers,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          extractApiErrorMessage(data, isEditing ? "Не удалось сохранить изменения" : "Не удалось создать точку"),
        );
      }
      onSaved(data);
      toast.success(isEditing ? "Изменения отправлены на модерацию" : "Точка добавлена в черновики");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : isEditing
            ? "Не удалось сохранить изменения"
            : "Не удалось создать точку",
      );
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-900/50 backdrop-blur-sm">
      <div className="min-h-screen bg-gray-50 sm:mx-auto sm:my-6 sm:min-h-0 sm:max-w-xl sm:rounded-2xl">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-gray-200 bg-white/95 px-5 py-4 backdrop-blur sm:rounded-t-2xl">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-500">
              {isEditing ? "Редактирование" : "Новая карточка"}
            </p>
            <h2 className="text-2xl font-black text-gray-900">
              {isEditing ? point!.name : "Точка забора"}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-full bg-gray-100 p-3 text-gray-700 hover:bg-gray-200" aria-label="Закрыть">
            <X className="h-5 w-5" />
          </button>
        </header>

        <form onSubmit={submit} className="space-y-5 p-5 pb-12">
          <section className="grid grid-cols-2 gap-2 rounded-xl bg-white p-2 shadow-sm">
            {[["quarry", "Карьер"], ["accumulator", "Накопитель"], ["warehouse", "Склад"], ["supplier", "Поставщик"]].map(([value, label]) => (
              <button key={value} type="button" onClick={() => setForm({ ...form, point_type: value })} className={`rounded-xl px-3 py-3 text-sm font-bold transition-colors ${form.point_type === value ? "bg-sky-500 text-white" : "text-gray-500 hover:bg-gray-50"}`}>
                {label}
              </button>
            ))}
          </section>

          <section className="space-y-3 rounded-xl bg-white p-5 shadow-sm">
            <input required placeholder="Название точки" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-xl border border-gray-200 p-3 text-gray-900 outline-none focus:border-sky-500" />
            <input placeholder="Короткое название для карты" value={form.short_name} onChange={(e) => setForm({ ...form, short_name: e.target.value })} className="w-full rounded-xl border border-gray-200 p-3 text-gray-900 outline-none focus:border-sky-500" />
            <textarea placeholder="Описание" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="min-h-24 w-full rounded-xl border border-gray-200 p-3 text-gray-900 outline-none focus:border-sky-500" />
          </section>

          <section className="rounded-xl bg-white p-5 shadow-sm">
            <label className="text-sm font-bold text-gray-900">Адрес</label>
            <div className="relative mt-2">
              <Search className="absolute left-3 top-3.5 h-5 w-5 text-gray-400" />
              <input
                value={form.address}
                onFocus={() => setShowSuggestions(true)}
                onChange={(event) => {
                  setForm({ ...form, address: event.target.value });
                  setShowSuggestions(true);
                }}
                placeholder="Начните вводить адрес"
                className="w-full rounded-xl border border-gray-200 py-3 pl-11 pr-3 text-gray-900 outline-none focus:border-sky-500"
              />
              {isGeocoding ? <Loader2 className="absolute right-3 top-3.5 h-5 w-5 animate-spin text-sky-500" /> : null}
              {showSuggestions && suggestions.length > 0 ? (
                <div className="absolute z-30 mt-2 max-h-56 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-xl">
                  {suggestions.map((item, index) => (
                    <button key={item.id || index} type="button" onClick={() => void selectSuggestion(item)} className="flex w-full items-start gap-2 rounded-lg px-3 py-3 text-left text-sm text-gray-700 hover:bg-sky-50">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />{suggestionLabel(item)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-gray-500">Адрес можно не указывать, если координаты отмечены на карте.</p>
          </section>

          <section className="rounded-xl bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2 font-bold text-gray-900"><MapPin className="h-5 w-5 text-sky-500" />Координаты</div>
            <div ref={mapContainerRef} className="h-64 w-full overflow-hidden rounded-xl bg-gray-100" />
            {!import.meta.env.VITE_2GIS_KEY ? <p className="mt-2 text-sm text-red-600">Ключ карты 2ГИС не настроен</p> : null}
            <p className="mt-2 text-xs text-gray-500">Перетащите маркер, чтобы уточнить место погрузки.</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <input type="number" step="any" placeholder="Широта" aria-label="Широта" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} className="rounded-xl border border-gray-200 p-3 text-gray-900 outline-none focus:border-sky-500" />
              <input type="number" step="any" placeholder="Долгота" aria-label="Долгота" value={form.lon} onChange={(e) => setForm({ ...form, lon: e.target.value })} className="rounded-xl border border-gray-200 p-3 text-gray-900 outline-none focus:border-sky-500" />
            </div>
          </section>

          <section className="rounded-xl bg-white p-5 shadow-sm">
            <h3 className="font-bold text-gray-900">Материалы и цены</h3>
            <p className="mt-1 text-sm text-gray-500">Можно выбрать несколько позиций.</p>
            <div className="mt-4 space-y-3">
              {materials.map((material) => {
                const selected = material.id in offerPrices;
                return (
                  <div key={material.id} className="flex items-center gap-3 rounded-xl border border-gray-200 p-3">
                    <button type="button" onClick={() => toggleMaterial(material.id)} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${selected ? "bg-sky-500 text-white" : "bg-gray-100 text-gray-400"}`}>
                      <Plus className={`h-4 w-4 ${selected ? "rotate-45" : ""}`} />
                    </button>
                    <span className="min-w-0 flex-1 font-semibold text-gray-900">{material.name}</span>
                    {selected ? (
                      <label className="flex items-center gap-1 text-sm text-gray-500">
                        <input required type="number" min="0.01" step="0.01" value={offerPrices[material.id]} onChange={(e) => setOfferPrices({ ...offerPrices, [material.id]: e.target.value })} className="w-24 rounded-lg border border-gray-200 p-2 text-right text-gray-900 outline-none focus:border-sky-500" />
                        ₽/{material.unit}
                      </label>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          <button disabled={isBusy} className="flex w-full items-center justify-center rounded-xl bg-sky-500 py-4 text-lg font-black text-white hover:bg-sky-600 disabled:opacity-50">
            {isBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : isEditing ? "Сохранить изменения" : "Сохранить точку"}
          </button>
        </form>
      </div>
    </div>
  );
}
