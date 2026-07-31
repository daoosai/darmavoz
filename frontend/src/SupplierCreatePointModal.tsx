import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ImagePlus, Loader2, MapPin, Search, X } from "lucide-react";
import toast from "react-hot-toast";

import {
  fetch2gisAddressSuggestions,
  get2gisSuggestionAddress,
  get2gisSuggestionCoordinates,
  get2gisSuggestionLabel,
  withTyumenBias,
} from "./addressSearch";
import { type MaterialProps } from "./MaterialDetailScreen";
import { baseURL, extractApiErrorMessage } from "./utils";

type EditablePointType = "quarry" | "accumulator";

type MaterialOfferDraft = {
  material_id: string;
  price: number;
  is_active: boolean;
};

type AddressSuggestion = {
  label: string;
  address: string;
  lat?: number;
  lon?: number;
};

type SupplierPointFormState = {
  point_type: EditablePointType;
  name: string;
  address: string;
  description: string;
  lat: string;
  lon: string;
  material_offers: MaterialOfferDraft[];
};

export interface SupplierPoint {
  id: string;
  point_type: "quarry" | "accumulator" | "warehouse" | "supplier";
  name: string;
  short_name?: string | null;
  address: string;
  description?: string | null;
  lat: number | null;
  lon: number | null;
  is_active?: boolean;
  moderation_status: string;
  moderation_comment?: string | null;
  pending_changes?: Record<string, unknown> | null;
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
  materials: MaterialProps[];
  point?: SupplierPoint | null;
  onClose: () => void;
  onSaved: (point: SupplierPoint) => void;
}

const DEFAULT_MAP_CENTER: [number, number] = [65.527202, 57.152223];

const normalizeEditablePointType = (value?: SupplierPoint["point_type"]): EditablePointType =>
  value === "accumulator" ? "accumulator" : "quarry";

const normalizeOptionalText = (value: string) => {
  const normalized = value.trim();
  return normalized || null;
};

const stringifyCoordinate = (value?: number | null) =>
  typeof value === "number" && Number.isFinite(value) ? String(value) : "";

const parseCoordinate = (value?: string | number | null) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeMaterialOffers = (offers: MaterialOfferDraft[]) => {
  const seen = new Set<string>();
  return offers
    .filter((offer) => offer.material_id && !seen.has(offer.material_id))
    .map((offer) => {
      seen.add(offer.material_id);
      return {
        material_id: offer.material_id,
        price: Number(offer.price),
        is_active: offer.is_active !== false,
      };
    });
};

const initialForm: SupplierPointFormState = {
  point_type: "quarry",
  name: "",
  address: "",
  description: "",
  lat: "",
  lon: "",
  material_offers: [],
};

const buildSupplierPointPayload = (form: SupplierPointFormState) => {
  const materialOffers = normalizeMaterialOffers(form.material_offers);
  const lat = parseCoordinate(form.lat);
  const lon = parseCoordinate(form.lon);
  return {
    point_type: form.point_type,
    name: form.name.trim(),
    short_name: form.name.trim(),
    address: form.address.trim(),
    description: normalizeOptionalText(form.description),
    lat,
    lon,
    material_ids: materialOffers.map((offer) => offer.material_id),
    material_offers: materialOffers,
    materials: materialOffers,
  };
};

const formatMaterialPrice = (price?: number | null) => {
  if (price == null || !Number.isFinite(Number(price)) || Number(price) <= 0) {
    return "цена не указана";
  }
  return `${Number(price).toLocaleString("ru-RU")} ₽`;
};

const buildInitialForm = (point?: SupplierPoint | null): SupplierPointFormState => {
  if (!point) {
    return initialForm;
  }
  return {
    point_type: normalizeEditablePointType(point.point_type),
    name: point.name,
    address: point.address || "",
    description: point.description || "",
    lat: stringifyCoordinate(point.lat),
    lon: stringifyCoordinate(point.lon),
    material_offers: (point.material_offers || [])
      .filter((offer) => offer.is_active !== false)
      .map((offer) => ({
        material_id: offer.material_id,
        price: Number(offer.price ?? 0),
        is_active: true,
      })),
  };
};

export default function SupplierCreatePointModal({
  token,
  materials,
  point,
  onClose,
  onSaved,
}: Props) {
  const isEditing = Boolean(point);
  const [form, setForm] = useState<SupplierPointFormState>(() => buildInitialForm(point));
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingFilePreviews, setPendingFilePreviews] = useState<string[]>([]);
  const addressContainerRef = useRef<HTMLDivElement | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const lastGeocodedAddressRef = useRef(normalizeOptionalText(point?.address || "")?.toLowerCase() || "");

  useEffect(() => {
    const nextForm = buildInitialForm(point);
    setForm(nextForm);
    lastGeocodedAddressRef.current = normalizeOptionalText(nextForm.address)?.toLowerCase() || "";
  }, [point]);

  useEffect(() => {
    const nextPreviews = pendingFiles.map((file) => URL.createObjectURL(file));
    setPendingFilePreviews(nextPreviews);
    return () => {
      nextPreviews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [pendingFiles]);

  useEffect(() => {
    const handleDocumentMouseDown = (event: MouseEvent) => {
      if (!addressContainerRef.current?.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => document.removeEventListener("mousedown", handleDocumentMouseDown);
  }, []);

  const parsedCoordinates = useMemo(() => {
    const lat = parseCoordinate(form.lat);
    const lon = parseCoordinate(form.lon);
    if (lat === null || lon === null) return null;
    return { lat, lon };
  }, [form.lat, form.lon]);

  const createDraggableMarker = (mapInstance: any, coordinates: [number, number]) => {
    const mapgl = (window as any).mapgl;
    const marker = new mapgl.Marker(mapInstance, {
      coordinates,
      draggable: true,
    });
    marker.on("dragend", (event: any) => {
      const [nextLon, nextLat] = event.target.getCoordinates();
      setForm((current) => ({
        ...current,
        lat: stringifyCoordinate(nextLat),
        lon: stringifyCoordinate(nextLon),
      }));
    });
    return marker;
  };

  useEffect(() => {
    const mapgl = (window as any).mapgl;
    const key = import.meta.env.VITE_2GIS_KEY;
    if (!mapgl || !key || !mapContainerRef.current || mapRef.current) return;

    const initialCoordinates = parsedCoordinates;
    const mapInstance = new mapgl.Map(mapContainerRef.current, {
      center: initialCoordinates
        ? [initialCoordinates.lon, initialCoordinates.lat]
        : DEFAULT_MAP_CENTER,
      zoom: 12,
      key,
    });

    mapRef.current = mapInstance;

    if (initialCoordinates) {
      markerRef.current = createDraggableMarker(mapInstance, [
        initialCoordinates.lon,
        initialCoordinates.lat,
      ]);
    }

    return () => {
      if (markerRef.current) {
        markerRef.current.destroy();
        markerRef.current = null;
      }
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
    };
  }, [parsedCoordinates]);

  useEffect(() => {
    const mapgl = (window as any).mapgl;
    if (!mapRef.current || !mapgl || !parsedCoordinates) return;

    const pointCoordinates: [number, number] = [parsedCoordinates.lon, parsedCoordinates.lat];
    mapRef.current.setCenter(pointCoordinates);

    if (markerRef.current) {
      markerRef.current.setCoordinates(pointCoordinates);
      return;
    }

    markerRef.current = createDraggableMarker(mapRef.current, pointCoordinates);
  }, [parsedCoordinates]);

  const uploadMediaFiles = async (
    pointId: string,
    files: File[],
    initialMedia: NonNullable<SupplierPoint["media_files"]> = [],
  ) => {
    let nextMedia = [...initialMedia];
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };

    for (const file of files) {
      const isPrimary = nextMedia.length === 0;
      const presignResponse = await fetch(`${baseURL}/media/presign-upload`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          file_name: file.name,
          content_type: file.type,
          file_size: file.size,
          entity_type: "quarry",
          entity_id: pointId,
          is_primary: isPrimary,
        }),
      });
      const presign = await presignResponse.json().catch(() => ({}));
      if (!presignResponse.ok) {
        throw new Error(extractApiErrorMessage(presign, "Не удалось подготовить загрузку фотографии"));
      }

      const uploadResponse = await fetch(presign.upload_url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadResponse.ok) {
        throw new Error("Не удалось загрузить фотографию");
      }

      const confirmResponse = await fetch(`${baseURL}/media/confirm`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          entity_type: "quarry",
          entity_id: pointId,
          object_key: presign.object_key,
          file_name: file.name,
          content_type: file.type,
          file_size: file.size,
          is_primary: isPrimary,
        }),
      });
      const confirmed = await confirmResponse.json().catch(() => ({}));
      if (!confirmResponse.ok || !confirmed.media_file) {
        throw new Error("Не удалось подтвердить фотографию");
      }

      nextMedia = [...nextMedia, confirmed.media_file];
    }

    return nextMedia;
  };

  const handleSelectFiles = (files: FileList | null) => {
    if (!files?.length) return;
    setPendingFiles((current) => [...current, ...Array.from(files)]);
  };

  const removePendingFile = (index: number) => {
    setPendingFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
  };

  const updateMaterialPrice = (materialId: string, nextValue: string) => {
    setForm((current) => ({
      ...current,
      material_offers: current.material_offers.map((offer) =>
        offer.material_id === materialId
          ? {
              ...offer,
              price: Number(nextValue),
            }
          : offer,
      ),
    }));
  };

  const toggleMaterial = (material: MaterialProps) => {
    setForm((current) => {
      const exists = current.material_offers.some((offer) => offer.material_id === material.id);
      if (exists) {
        return {
          ...current,
          material_offers: current.material_offers.filter((offer) => offer.material_id !== material.id),
        };
      }
      return {
        ...current,
        material_offers: [
          ...current.material_offers,
          {
            material_id: material.id,
            price: Number(material.price || 0),
            is_active: true,
          },
        ],
      };
    });
  };

  const getCoordsFromBackend = async (address: string) => {
    setIsGeocoding(true);
    try {
      const response = await fetch(
        `${baseURL}/geo/geocode?address=${encodeURIComponent(withTyumenBias(address))}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data, "Не удалось определить координаты по адресу"));
      }
      const lat = Number(data.lat);
      const lon = Number(data.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return { lat, lon };
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось определить координаты по адресу");
    } finally {
      setIsGeocoding(false);
    }
    return null;
  };

  const handleAddressChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    lastGeocodedAddressRef.current = "";
    setForm((current) => ({ ...current, address: value }));
    setShowSuggestions(true);

    if (!value.trim()) {
      setSuggestions([]);
      return;
    }

    const nextSuggestions = await fetch2gisAddressSuggestions(value);
    setSuggestions(
      nextSuggestions
        .map((item: any) => {
          const address = get2gisSuggestionAddress(item);
          const label = get2gisSuggestionLabel(item);
          const { lat, lon } = get2gisSuggestionCoordinates(item);
          return {
            label: label || address,
            address,
            lat,
            lon,
          };
        })
        .filter((item) => Boolean(item.address)),
    );
  };

  const selectSuggestion = async (suggestion: AddressSuggestion) => {
    const address = suggestion.address.trim() || suggestion.label.trim();
    setShowSuggestions(false);
    setSuggestions([]);

    if (typeof suggestion.lat === "number" && typeof suggestion.lon === "number") {
      lastGeocodedAddressRef.current = address.toLowerCase();
      setForm((current) => ({
        ...current,
        address,
        lat: stringifyCoordinate(suggestion.lat),
        lon: stringifyCoordinate(suggestion.lon),
      }));
      return;
    }

    setForm((current) => ({ ...current, address }));
    const coords = await getCoordsFromBackend(address);
    if (!coords) return;

    lastGeocodedAddressRef.current = address.toLowerCase();
    setForm((current) => ({
      ...current,
      address,
      lat: stringifyCoordinate(coords.lat),
      lon: stringifyCoordinate(coords.lon),
    }));
  };

  const handleLatChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    const parts = value.split(/[,\s]+/);
    if (parts.length >= 2) {
      const lat = parseCoordinate(parts[0]);
      const lon = parseCoordinate(parts[1]);
      if (lat !== null && lon !== null) {
        setForm((current) => ({
          ...current,
          lat: stringifyCoordinate(lat),
          lon: stringifyCoordinate(lon),
        }));
        return;
      }
    }
    setForm((current) => ({ ...current, lat: value }));
  };

  const handleLonChange = (event: ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({ ...current, lon: event.target.value }));
  };

  const submitPointForModeration = async (pointId: string) => {
    const response = await fetch(`${baseURL}/supplier/points/${pointId}/submit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorSource =
        data && typeof data === "object" && !Array.isArray(data)
          ? { ...data, status: response.status }
          : { detail: data, status: response.status };
      throw new Error(extractApiErrorMessage(errorSource, "Не удалось отправить точку на модерацию"));
    }
    return data as SupplierPoint;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = form.name.trim();
    const address = form.address.trim();
    const normalizedOffers = normalizeMaterialOffers(form.material_offers);
    let lat = parseCoordinate(form.lat);
    let lon = parseCoordinate(form.lon);

    if (!name) {
      toast.error("Укажите название точки");
      return;
    }
    if (!address) {
      toast.error("Укажите адрес точки");
      return;
    }
    if (normalizedOffers.length === 0) {
      toast.error("Добавьте хотя бы один материал с ценой");
      return;
    }
    if (normalizedOffers.some((offer) => !Number.isFinite(offer.price) || offer.price <= 0)) {
      toast.error("Укажите корректную цену для каждого выбранного материала");
      return;
    }

    if (lat === null || lon === null) {
      const addressKey = address.toLowerCase();
      if (lastGeocodedAddressRef.current !== addressKey) {
        const coords = await getCoordsFromBackend(address);
        if (coords) {
          lat = coords.lat;
          lon = coords.lon;
          lastGeocodedAddressRef.current = addressKey;
          setForm((current) => ({
            ...current,
            lat: stringifyCoordinate(coords.lat),
            lon: stringifyCoordinate(coords.lon),
          }));
        }
      }
    }

    setIsBusy(true);
    try {
      const payload = buildSupplierPointPayload({
        ...form,
        lat: stringifyCoordinate(lat),
        lon: stringifyCoordinate(lon),
        material_offers: normalizedOffers,
      });

      const response = await fetch(
        isEditing ? `${baseURL}/supplier/points/${point!.id}` : `${baseURL}/supplier/points`,
        {
          method: isEditing ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errorSource =
          data && typeof data === "object" && !Array.isArray(data)
            ? { ...data, status: response.status }
            : { detail: data, status: response.status };
        throw new Error(
          extractApiErrorMessage(
            errorSource,
            isEditing ? "Не удалось сохранить изменения" : "Не удалось создать точку",
          ),
        );
      }

      let savedPoint = data as SupplierPoint;
      if (pendingFiles.length > 0 && savedPoint.id) {
        const uploadedMedia = await uploadMediaFiles(savedPoint.id, pendingFiles, savedPoint.media_files || []);
        savedPoint = {
          ...savedPoint,
          media_files: uploadedMedia,
          primary_image_url:
            uploadedMedia.find((media) => media.is_primary)?.public_url ||
            uploadedMedia[0]?.public_url ||
            null,
        };
      }

      if (!isEditing && savedPoint.id) {
        try {
          savedPoint = await submitPointForModeration(savedPoint.id);
        } catch (submitError) {
          onSaved(savedPoint);
          toast.error(
            submitError instanceof Error
              ? `Точка сохранена как черновик.\n${submitError.message}`
              : "Точка сохранена как черновик",
          );
          return;
        }
      }

      onSaved(savedPoint);
      toast.success(
        isEditing
          ? "Изменения сохранены и отправлены на повторную модерацию"
          : "Анкета точки отправлена на модерацию",
      );
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

  const existingMedia = point?.media_files || [];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-sm">
      <div className="min-h-screen bg-slate-50 sm:mx-auto sm:my-6 sm:min-h-0 sm:max-w-xl sm:rounded-3xl">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur sm:rounded-t-3xl">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-500">
              {isEditing ? "Редактирование" : "Новая анкета"}
            </p>
            <h2 className="text-2xl font-black text-slate-900">
              {isEditing ? point!.name : "Добавить точку"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full bg-slate-100 p-3 text-slate-700 hover:bg-slate-200"
            aria-label="Закрыть"
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <form onSubmit={submit} className="space-y-5 p-5 pb-12">
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <label className="text-sm font-bold text-slate-900">Тип точки</label>
            <select
              value={form.point_type}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  point_type: event.target.value as EditablePointType,
                }))
              }
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-slate-900 outline-none focus:border-sky-500"
            >
              <option value="quarry">Карьер</option>
              <option value="accumulator">Накопитель</option>
            </select>
          </section>

          <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
            <div>
              <label className="text-sm font-bold text-slate-900">Название</label>
              <input
                required
                placeholder="Например, Карьер Северный"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-slate-900 outline-none focus:border-sky-500"
              />
            </div>

            <div ref={addressContainerRef} className="relative">
              <label className="text-sm font-bold text-slate-900">Адрес</label>
              <div className="relative mt-2">
                <Search className="absolute left-3 top-3.5 h-5 w-5 text-slate-400" />
                <input
                  value={form.address}
                  onFocus={() => setShowSuggestions(true)}
                  onChange={handleAddressChange}
                  placeholder="Укажите адрес точки"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-3 text-slate-900 outline-none focus:border-sky-500"
                />
                {showSuggestions && suggestions.length > 0 ? (
                  <div className="absolute z-30 mt-2 max-h-56 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-xl">
                    {suggestions.map((item, index) => (
                      <button
                        key={`${item.address}-${index}`}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          void selectSuggestion(item);
                        }}
                        className="flex w-full items-start gap-2 rounded-xl px-3 py-3 text-left text-sm text-slate-700 hover:bg-sky-50"
                      >
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Выберите адрес из подсказок или уточните точку маркером на карте.
              </p>
            </div>

            <div>
              <label className="text-sm font-bold text-slate-900">Описание</label>
              <textarea
                placeholder="Коротко опишите точку, режим работы и особенности подъезда"
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
                className="mt-2 min-h-28 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-slate-900 outline-none focus:border-sky-500"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Карта 2ГИС
              </label>
              <div
                ref={mapContainerRef}
                className="h-48 min-h-[192px] w-full overflow-hidden rounded-xl bg-slate-200"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Широта (Lat)
                </label>
                <input
                  type="text"
                  value={form.lat}
                  onChange={handleLatChange}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-medium text-slate-900 outline-none transition-all focus:border-[#2DB0E6] focus:ring-2 focus:ring-[#2DB0E6]/20"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Долгота (Lon)
                </label>
                <input
                  type="text"
                  value={form.lon}
                  onChange={handleLonChange}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-medium text-slate-900 outline-none transition-all focus:border-[#2DB0E6] focus:ring-2 focus:ring-[#2DB0E6]/20"
                />
              </div>
            </div>
            {isGeocoding ? (
              <p className="text-xs text-slate-500">Определяем координаты по адресу...</p>
            ) : null}
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Материалы и цены</h3>
              <p className="mt-1 text-xs text-slate-500">
                Выберите материалы, которые доступны на точке. Базовая цена подставляется автоматически, её можно изменить.
              </p>
            </div>

            {materials.length > 0 ? (
              <div className="mt-4 max-h-72 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
                {materials.map((material) => {
                  const offer = form.material_offers.find((item) => item.material_id === material.id);
                  const isChecked = Boolean(offer);
                  return (
                    <div
                      key={material.id}
                      className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleMaterial(material)}
                          className="mt-1 h-5 w-5 rounded border-slate-300 text-sky-500 focus:ring-sky-500"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-bold text-slate-900">{material.name}</p>
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500">
                              {material.unit}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            Базовая цена: {formatMaterialPrice(material.price)}
                          </p>
                          {isChecked ? (
                            <div className="mt-3 flex items-center gap-3">
                              <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                Цена
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={offer?.price ?? ""}
                                onChange={(event) => updateMaterialPrice(material.id, event.target.value)}
                                className="w-36 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                                placeholder="Цена"
                              />
                              <span className="text-sm text-slate-500">₽ / {material.unit}</span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                Материалы пока не загрузились
              </div>
            )}
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Фотографии</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Добавьте фото точки. Основное фото выберется автоматически.
                </p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-sky-400 hover:text-sky-600">
                <ImagePlus className="h-4 w-4" />
                Добавить
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => handleSelectFiles(event.target.files)}
                />
              </label>
            </div>

            {existingMedia.length > 0 ? (
              <div className="mt-4 grid grid-cols-3 gap-3">
                {existingMedia.map((media) => (
                  <div key={media.id} className="relative aspect-square overflow-hidden rounded-2xl bg-slate-100">
                    <img src={media.public_url} alt="Фото точки" className="h-full w-full object-cover" />
                    {media.is_primary ? (
                      <span className="absolute left-2 top-2 rounded-full bg-slate-900/80 px-2 py-1 text-[10px] font-bold text-white">
                        Основное
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {pendingFiles.length > 0 ? (
              <div className="mt-4 grid grid-cols-3 gap-3">
                {pendingFiles.map((file, index) => (
                  <div
                    key={`${file.name}-${index}`}
                    className="relative aspect-square overflow-hidden rounded-2xl border border-slate-200 bg-slate-100"
                  >
                    <img
                      src={pendingFilePreviews[index]}
                      alt={file.name}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-slate-900/70 px-2 py-1 text-[10px] font-semibold text-white">
                      <span className="block truncate">{file.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removePendingFile(index)}
                      className="absolute right-2 top-2 rounded-full bg-white/95 px-2 py-1 text-[10px] font-bold text-slate-600 shadow-sm hover:text-rose-600"
                    >
                      Убрать
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {existingMedia.length === 0 && pendingFiles.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                Фото пока не добавлены
              </div>
            ) : null}
          </section>

          <button
            disabled={isBusy}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 py-4 text-lg font-black text-white hover:bg-sky-600 disabled:opacity-50"
          >
            {isBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
            {isEditing ? "Сохранить и отправить на модерацию" : "Отправить на модерацию"}
          </button>
        </form>
      </div>
    </div>
  );
}
