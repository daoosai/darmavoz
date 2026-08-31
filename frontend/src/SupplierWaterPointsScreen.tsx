import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Droplets, ImagePlus, Loader2, MapPin, Pencil, Phone, Plus, Search, Star, Trash2, X } from "lucide-react";
import toast from "react-hot-toast";

import {
  fetch2gisAddressSuggestions,
  get2gisSuggestionAddress,
  get2gisSuggestionCoordinates,
  get2gisSuggestionLabel,
  withTyumenBias,
} from "./addressSearch";
import MapWebGLFallback, { load2GisMapSdk, tryCreate2GisMap } from "./components/MapWebGLFallback";
import { useAuthStore } from "./store";
import { baseURL, extractApiErrorMessage, formatPhoneNumber, resolveMediaUrl } from "./utils";

type WaterType = "free" | "paid";

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
  price_unit?: string | null;
  description?: string | null;
  primary_image_url?: string | null;
  moderation_status: string;
  moderation_comment?: string | null;
}

type AddressSuggestion = {
  label: string;
  address: string;
  lat?: number;
  lon?: number;
};

const EMPTY_FORM = {
  water_type: "free" as WaterType,
  name: "",
  source: "",
  address: "",
  lat: "",
  lon: "",
  phone: "",
  price: "",
  price_unit: "литр",
  description: "",
};

const WATER_POINT_DRAFT_STORAGE_KEY = "water_point_draft";

const DEFAULT_MAP_CENTER: [number, number] = [65.527202, 57.152223];

const statusText: Record<string, string> = {
  pending_moderation: "На модерации",
  approved: "Одобрено",
  rejected: "Отклонено",
  suspended: "Приостановлено",
};

const normalizeModerationStatus = (status?: string | null) => status?.toLowerCase() || "";

const getModerationStatusClass = (status?: string | null) => {
  switch (normalizeModerationStatus(status)) {
    case "approved":
      return "bg-green-100 text-green-800";
    case "rejected":
      return "bg-red-100 text-red-800";
    case "suspended":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
};

const stringifyCoordinate = (value?: number | null) =>
  typeof value === "number" && Number.isFinite(value) ? String(value) : "";

const parseCoordinate = (value?: string | number | null) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatWaterPointPhone = (value?: string | null) => {
  if (!value?.trim()) return "";
  return formatPhoneNumber(value);
};

const normalizePhoneForApi = (value: string) => {
  let digits = value.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("8")) {
    digits = `7${digits.slice(1)}`;
  } else if (!digits.startsWith("7")) {
    digits = `7${digits}`;
  }

  return `+${digits.slice(0, 11)}`;
};

const readWaterPointDraft = (storageKey: string): typeof EMPTY_FORM | null => {
  try {
    const savedDraft = localStorage.getItem(storageKey);
    if (!savedDraft) return null;

    const draft = JSON.parse(savedDraft) as Partial<typeof EMPTY_FORM>;
    if (!draft || typeof draft !== "object") return null;

    return {
      water_type: draft.water_type === "paid" ? "paid" : "free",
      name: typeof draft.name === "string" ? draft.name : "",
      source: typeof draft.source === "string" ? draft.source : "",
      address: typeof draft.address === "string" ? draft.address : "",
      lat: typeof draft.lat === "string" ? draft.lat : "",
      lon: typeof draft.lon === "string" ? draft.lon : "",
      phone: typeof draft.phone === "string" ? formatWaterPointPhone(draft.phone) : "",
      price: typeof draft.price === "string" ? draft.price : "",
      price_unit: typeof draft.price_unit === "string" ? draft.price_unit : EMPTY_FORM.price_unit,
      description: typeof draft.description === "string" ? draft.description : "",
    };
  } catch {
    return null;
  }
};

const hasWaterPointDraftContent = (form: typeof EMPTY_FORM) =>
  form.water_type !== EMPTY_FORM.water_type ||
  form.name.trim() !== "" ||
  form.source.trim() !== "" ||
  form.address.trim() !== "" ||
  form.lat.trim() !== "" ||
  form.lon.trim() !== "" ||
  form.phone.trim() !== "" ||
  form.price.trim() !== "" ||
  form.price_unit !== EMPTY_FORM.price_unit ||
  form.description.trim() !== "";

const extractProfilePhone = (profile?: { phone?: unknown; phone_number?: unknown } | null) => {
  for (const value of [profile?.phone, profile?.phone_number]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

interface SupplierWaterPointsScreenProps {
  token: string;
  apiPrefix?: string;
  draftStorageKey?: string;
}

export default function SupplierWaterPointsScreen({
  token,
  apiPrefix = "/supplier",
  draftStorageKey = WATER_POINT_DRAFT_STORAGE_KEY,
}: SupplierWaterPointsScreenProps) {
  const apiBase = `${baseURL}${apiPrefix}`;
  const [points, setPoints] = useState<WaterPoint[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [isDraftLoaded, setIsDraftLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingFilePreviews, setPendingFilePreviews] = useState<string[]>([]);
  const [primaryPhotoIndex, setPrimaryPhotoIndex] = useState(0);
  const [editingPoint, setEditingPoint] = useState<WaterPoint | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WaterPoint | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isMapUnavailable, setIsMapUnavailable] = useState(false);
  const addressContainerRef = useRef<HTMLDivElement | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const lastGeocodedAddressRef = useRef("");
  const skipNextDraftSaveRef = useRef(false);
  const hasSavedDraftRef = useRef(false);
  const phoneWasEditedRef = useRef(false);
  const currentUser = useAuthStore((state) => state.currentUser);
  const setCurrentUser = useAuthStore((state) => state.setCurrentUser);
  const [profilePhone, setProfilePhone] = useState(() => formatWaterPointPhone(extractProfilePhone(currentUser)));

  const loadPoints = async () => {
    const response = await fetch(`${apiBase}/water-points`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => []);
    if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось загрузить точки воды"));
    setPoints(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    void loadPoints().catch((error) =>
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить точки воды"),
    );
  }, [apiBase, token]);

  useEffect(() => {
    const savedDraft = readWaterPointDraft(draftStorageKey);
    if (savedDraft) {
      hasSavedDraftRef.current = true;
      setForm(savedDraft);
      setShowForm(hasWaterPointDraftContent(savedDraft));
    }
    setIsDraftLoaded(true);
  }, [draftStorageKey]);

  useEffect(() => {
    if (!isDraftLoaded || editingPoint) return;
    if (skipNextDraftSaveRef.current) {
      skipNextDraftSaveRef.current = false;
      return;
    }

    try {
      localStorage.setItem(draftStorageKey, JSON.stringify(form));
    } catch {
      // localStorage может быть недоступен в приватном режиме браузера.
    }
  }, [draftStorageKey, editingPoint, form, isDraftLoaded]);

  useEffect(() => {
    const nextPreviews = pendingFiles.map((file) => URL.createObjectURL(file));
    setPendingFilePreviews(nextPreviews);

    return () => {
      nextPreviews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [pendingFiles]);

  useEffect(() => {
    let cancelled = false;

    const loadSupplierProfile = async () => {
      try {
        const response = await fetch(`${apiBase}/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || cancelled) return;

        const phone = extractProfilePhone(data);
        const formattedPhone = formatWaterPointPhone(phone);
        setProfilePhone(formattedPhone);
        if (formattedPhone && !hasSavedDraftRef.current && !phoneWasEditedRef.current) {
          setForm((current) => (current.phone.trim() ? current : { ...current, phone: formattedPhone }));
        }
        setCurrentUser({
          id: currentUser?.id || apiPrefix,
          name: typeof data.display_name === "string" ? data.display_name : currentUser?.name || "",
          phone: phone || null,
        });
      } catch {
        // Если профиль недоступен, пользователь всё равно может заполнить телефон вручную.
      }
    };

    void loadSupplierProfile();
    return () => {
      cancelled = true;
    };
  }, [apiBase, apiPrefix, token, setCurrentUser]);

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
  const parsedCoordinatesRef = useRef(parsedCoordinates);
  parsedCoordinatesRef.current = parsedCoordinates;

  const createDraggableMarker = (mapInstance: any, coordinates: [number, number]) => {
    const mapgl = (window as any).mapgl;
    const marker = new mapgl.Marker(mapInstance, { coordinates, draggable: true });
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
    let disposed = false;
    const key = import.meta.env.VITE_2GIS_KEY;
    if (!showForm || !key || !mapContainerRef.current || mapRef.current) return;

    void load2GisMapSdk()
      .then((mapgl) => {
        if (disposed || !mapContainerRef.current || mapRef.current) return;
        const initialCoordinates = parsedCoordinatesRef.current;
        const mapInstance = tryCreate2GisMap(
          () =>
            new mapgl.Map(mapContainerRef.current, {
              center: initialCoordinates
                ? [initialCoordinates.lon, initialCoordinates.lat]
                : DEFAULT_MAP_CENTER,
              zoom: 12,
              key,
            }),
          () => setIsMapUnavailable(true),
        );
        if (!mapInstance) return;
        if (disposed) {
          mapInstance.destroy();
          return;
        }

        mapInstance.on("click", (event: any) => {
          const [nextLon, nextLat] = event?.lngLat || [];
          if (!Number.isFinite(nextLat) || !Number.isFinite(nextLon)) return;
          setForm((current) => ({
            ...current,
            lat: stringifyCoordinate(nextLat),
            lon: stringifyCoordinate(nextLon),
          }));
        });
        mapRef.current = mapInstance;
        if (initialCoordinates) {
          markerRef.current = createDraggableMarker(mapInstance, [
            initialCoordinates.lon,
            initialCoordinates.lat,
          ]);
        }
      })
      .catch(() => !disposed && setIsMapUnavailable(true));

    return () => {
      disposed = true;
      if (markerRef.current) {
        markerRef.current.destroy();
        markerRef.current = null;
      }
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
    };
  }, [showForm]);

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

  const update = (field: keyof typeof EMPTY_FORM, value: string) => {
    if (field === "phone") {
      phoneWasEditedRef.current = true;
      setForm((current) => ({ ...current, phone: formatWaterPointPhone(value) }));
      return;
    }
    setForm((current) => ({ ...current, [field]: value }));
  };

  const openCreateForm = () => {
    if (editingPoint || !showForm) {
      const savedDraft = readWaterPointDraft(draftStorageKey);
      skipNextDraftSaveRef.current = true;
      setForm(savedDraft || (editingPoint ? { ...EMPTY_FORM, phone: profilePhone } : form));
    }
    setEditingPoint(null);
    setShowForm(true);
  };

  const openEditForm = (point: WaterPoint) => {
    setEditingPoint(point);
    setForm({
      water_type: point.water_type === "paid" ? "paid" : "free",
      name: point.name || "",
      source: point.source,
      address: point.address,
      lat: stringifyCoordinate(point.lat),
      lon: stringifyCoordinate(point.lon),
      phone: formatWaterPointPhone(point.phone),
      price: point.price === null || point.price === undefined ? "" : String(point.price),
      price_unit: point.price_unit || EMPTY_FORM.price_unit,
      description: point.description || "",
    });
    lastGeocodedAddressRef.current = point.address?.trim().toLowerCase() || "";
    setPendingFiles([]);
    setPrimaryPhotoIndex(0);
    setShowForm(true);
  };

  const closeForm = () => {
    if (editingPoint) {
      const savedDraft = readWaterPointDraft(draftStorageKey);
      skipNextDraftSaveRef.current = true;
      setEditingPoint(null);
      setForm(savedDraft || { ...EMPTY_FORM, phone: profilePhone });
      setPendingFiles([]);
      setPrimaryPhotoIndex(0);
    }
    setShowForm(false);
  };

  const getCoordsFromBackend = async (address: string) => {
    setIsGeocoding(true);
    try {
      const response = await fetch(
        `${baseURL}/geo/geocode?address=${encodeURIComponent(withTyumenBias(address))}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data, "Не удалось определить координаты по адресу"));
      }
      const lat = Number(data.lat);
      const lon = Number(data.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось определить координаты по адресу");
    } finally {
      setIsGeocoding(false);
    }
    return null;
  };

  const handleAddressChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const address = event.target.value;
    lastGeocodedAddressRef.current = "";
    setForm((current) => ({ ...current, address, lat: "", lon: "" }));
    setShowSuggestions(true);

    if (!address.trim()) {
      setSuggestions([]);
      return;
    }

    const nextSuggestions = await fetch2gisAddressSuggestions(address);
    setSuggestions(
      nextSuggestions
        .map((item: any) => {
          const suggestionAddress = get2gisSuggestionAddress(item);
          const label = get2gisSuggestionLabel(item);
          const { lat, lon } = get2gisSuggestionCoordinates(item);
          return { label: label || suggestionAddress, address: suggestionAddress, lat, lon };
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
    const coordinates = await getCoordsFromBackend(address);
    if (!coordinates) return;

    lastGeocodedAddressRef.current = address.toLowerCase();
    setForm((current) => ({
      ...current,
      address,
      lat: stringifyCoordinate(coordinates.lat),
      lon: stringifyCoordinate(coordinates.lon),
    }));
  };

  const handleAddressBlur = async () => {
    const address = form.address.trim();
    if (!address || parsedCoordinates) return;
    const coordinates = await getCoordsFromBackend(address);
    if (!coordinates) return;
    lastGeocodedAddressRef.current = address.toLowerCase();
    setForm((current) => ({
      ...current,
      lat: stringifyCoordinate(coordinates.lat),
      lon: stringifyCoordinate(coordinates.lon),
    }));
  };

  const uploadWaterPointPhoto = async (
    pointId: string,
    file: File,
    isPrimary: boolean,
    sortOrder: number,
  ) => {
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    const presignResponse = await fetch(`${baseURL}/media/presign-upload`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        entity_type: "water_point",
        entity_id: pointId,
        file_name: file.name,
        content_type: file.type,
        file_size: file.size,
        is_primary: isPrimary,
        sort_order: sortOrder,
      }),
    });
    const presign = await presignResponse.json().catch(() => ({}));
    if (!presignResponse.ok) {
      throw new Error(extractApiErrorMessage(presign, "Не удалось подготовить загрузку фото"));
    }

    const uploadResponse = await fetch(presign.upload_url, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!uploadResponse.ok) {
      throw new Error("Не удалось загрузить фотографию в хранилище");
    }

    const confirmResponse = await fetch(`${baseURL}/media/confirm`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        entity_type: "water_point",
        entity_id: pointId,
        object_key: presign.object_key,
        file_name: file.name,
        content_type: file.type,
        file_size: file.size,
        is_primary: isPrimary,
        sort_order: sortOrder,
      }),
    });
    const confirmed = await confirmResponse.json().catch(() => ({}));
    if (!confirmResponse.ok) {
      throw new Error(extractApiErrorMessage(confirmed, "Не удалось подтвердить фото"));
    }
  };

  const handleSelectFiles = (files: FileList | null) => {
    const images = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    setPendingFiles((current) => [...current, ...images]);
  };

  const removePendingFile = (index: number) => {
    setPendingFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
    setPrimaryPhotoIndex((current) => {
      if (index < current) return current - 1;
      if (index === current) return Math.max(0, current - 1);
      return current;
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const pointBeingEdited = editingPoint;
    const isPaid = form.water_type === "paid";
    const address = form.address.trim();
    const phone = normalizePhoneForApi(form.phone);
    let lat = parseCoordinate(form.lat);
    let lon = parseCoordinate(form.lon);

    if ((lat === null) !== (lon === null)) {
      toast.error("Укажите обе координаты точки воды.");
      return;
    }
    if (!address && (lat === null || lon === null)) {
      toast.error("Укажите адрес или обе координаты точки воды.");
      return;
    }
    if (lat === null || lon === null) {
      const addressKey = address.toLowerCase();
      if (lastGeocodedAddressRef.current !== addressKey) {
        const coordinates = await getCoordsFromBackend(address);
        if (coordinates) {
          lat = coordinates.lat;
          lon = coordinates.lon;
          lastGeocodedAddressRef.current = addressKey;
          setForm((current) => ({
            ...current,
            lat: stringifyCoordinate(coordinates.lat),
            lon: stringifyCoordinate(coordinates.lon),
          }));
        }
      }
    }
    if (lat === null || lon === null) {
      toast.error("Выберите адрес из подсказок или укажите точку на карте.");
      return;
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      toast.error("Укажите корректные широту и долготу точки воды.");
      return;
    }
    if (isPaid && (!phone || !form.price || !form.price_unit.trim())) {
      toast.error("Для платной воды заполните телефон, цену и единицу измерения.");
      return;
    }

    let createdPoint: WaterPoint | null = null;
    setSaving(true);
    try {
      const payload = {
        water_type: form.water_type,
        name: form.name.trim() || null,
        source: form.source.trim(),
        address: address || null,
        lat,
        lon,
        phone: phone || null,
        price: isPaid ? Number(form.price) : null,
        price_unit: isPaid ? form.price_unit.trim() : null,
        description: isPaid ? form.description.trim() || null : null,
      };
      const response = await fetch(
        pointBeingEdited
          ? `${apiBase}/water-points/${pointBeingEdited.id}`
          : `${apiBase}/water-points`,
        {
          method: pointBeingEdited ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось сохранить точку воды"));
      createdPoint = data as WaterPoint;

      for (const [index, file] of pendingFiles.entries()) {
        await uploadWaterPointPhoto(createdPoint.id, file, index === primaryPhotoIndex, index);
      }

      toast.success(
        pendingFiles.length > 0
          ? pointBeingEdited
            ? "Изменения точки и фотографии отправлены на модерацию."
            : "Точка воды и фотографии отправлены на модерацию."
          : pointBeingEdited
            ? "Изменения точки отправлены на модерацию."
            : "Точка воды отправлена на модерацию.",
      );
      if (!pointBeingEdited) {
        skipNextDraftSaveRef.current = true;
        localStorage.removeItem(draftStorageKey);
      } else {
        skipNextDraftSaveRef.current = true;
      }
      setEditingPoint(null);
      setForm({ ...EMPTY_FORM, phone: profilePhone });
      setPendingFiles([]);
      setPrimaryPhotoIndex(0);
      setShowForm(false);
      await loadPoints();
    } catch (error) {
      if (createdPoint && !pointBeingEdited) {
        const rollbackResponse = await fetch(`${apiBase}/water-points/${createdPoint.id}/hard`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => null);
        if (rollbackResponse?.ok) {
          toast.error("Не удалось загрузить фотографии. Заявка не создана — попробуйте отправить форму ещё раз.");
        } else {
          await loadPoints();
          toast.error("Точка воды создана, но часть фото не удалось загрузить. Удалите заявку и отправьте её снова.");
        }
        return;
      }
      if (createdPoint) {
        await loadPoints();
        toast.error("Данные точки сохранены, но часть фото не удалось загрузить.");
        return;
      }
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить точку воды");
    } finally {
      setSaving(false);
    }
  };

  const hardDeletePoint = async () => {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget.id);
    try {
      const response = await fetch(`${apiBase}/water-points/${deleteTarget.id}/hard`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось удалить заявку"));
      setDeleteTarget(null);
      await loadPoints();
      toast.success("Заявка полностью удалена.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить заявку");
    } finally {
      setDeletingId(null);
    }
  };

  const isPaid = form.water_type === "paid";
  const isEditing = Boolean(editingPoint);
  return (
    <div className="space-y-4 px-4 pb-24 pt-[max(env(safe-area-inset-top),2.5rem)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="rounded-2xl bg-sky-100 p-3 text-sky-600"><Droplets /></span>
          <div><h1 className="text-xl font-black">Точки воды</h1><p className="text-sm text-slate-500">Бесплатная и платная вода</p></div>
        </div>
        <button type="button" onClick={openCreateForm} className="rounded-xl bg-sky-500 p-3 text-white" aria-label="Добавить точку воды"><Plus /></button>
      </div>

      {showForm ? <form onSubmit={submit} className="space-y-4 rounded-3xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-black">{isEditing ? "Редактирование точки воды" : "Новая точка воды"}</h2>
          <button type="button" onClick={closeForm} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label="Закрыть форму точки воды" title="Закрыть">
            <X className="h-5 w-5" />
          </button>
        </div>
        <label className="block text-sm font-bold">Тип воды<select value={form.water_type} onChange={(event) => update("water_type", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3"><option value="free">Бесплатная вода</option><option value="paid">Платная вода</option></select></label>
        <label className="block text-sm font-bold">Название {isPaid ? <span className="text-red-500">*</span> : <span className="font-normal text-slate-400">(необязательно)</span>}<input required={isPaid} value={form.name} onChange={(event) => update("name", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3" /></label>
        <label className="block text-sm font-bold">Источник <span className="text-red-500">*</span><input required value={form.source} onChange={(event) => update("source", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3" /></label>
        <label className="block text-sm font-bold">Телефон {isPaid ? <span className="text-red-500">*</span> : <span className="font-normal text-slate-400">(необязательно)</span>}<input required={isPaid} type="tel" inputMode="tel" autoComplete="tel" maxLength={18} value={form.phone} onChange={(event) => update("phone", event.target.value)} placeholder="+7 (999) 999-99-99" className="mt-1 w-full rounded-xl border border-slate-200 p-3" /></label>

        <div className="space-y-2">
          <label className="block text-sm font-bold" htmlFor="water-point-address">Адрес <span className="font-normal text-slate-400">(необязательно, если указаны координаты)</span></label>
          <div ref={addressContainerRef} className="relative z-30">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input id="water-point-address" required={!parsedCoordinates} value={form.address} onFocus={() => setShowSuggestions(true)} onBlur={() => void handleAddressBlur()} onChange={handleAddressChange} placeholder="Начните вводить адрес" className="w-full rounded-xl border border-slate-200 py-3 pl-10 pr-3" />
            {showSuggestions && suggestions.length > 0 ? <div className="absolute z-[100000] mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">{suggestions.map((suggestion, index) => <button key={`${suggestion.address}-${index}`} type="button" onMouseDown={(event) => { event.preventDefault(); void selectSuggestion(suggestion); }} className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" /><span>{suggestion.label}</span></button>)}</div> : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-bold">Широта<input type="number" min="-90" max="90" step="any" required={!form.address.trim()} value={form.lat} onChange={(event) => update("lat", event.target.value)} placeholder="Например, 57.152286" className="mt-1 w-full rounded-xl border border-slate-200 p-3 font-normal" /></label>
            <label className="block text-sm font-bold">Долгота<input type="number" min="-180" max="180" step="any" required={!form.address.trim()} value={form.lon} onChange={(event) => update("lon", event.target.value)} placeholder="Например, 65.534328" className="mt-1 w-full rounded-xl border border-slate-200 p-3 font-normal" /></label>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            {isMapUnavailable ? <MapWebGLFallback className="h-52" /> : <div ref={mapContainerRef} className="h-52 w-full" />}
          </div>
          <p className="text-xs text-slate-500">{isGeocoding ? "Определяем координаты…" : parsedCoordinates ? `Координаты выбраны: ${parsedCoordinates.lat.toFixed(6)}, ${parsedCoordinates.lon.toFixed(6)}` : "Выберите адрес из подсказок или укажите точку на карте."}</p>
        </div>

        {isPaid ? <><div className="grid grid-cols-2 gap-3"><label className="text-sm font-bold">Цена <span className="text-red-500">*</span><input required type="number" min="0.01" step="0.01" value={form.price} onChange={(event) => update("price", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3" /></label><label className="text-sm font-bold">Единица <span className="text-red-500">*</span><input required value={form.price_unit} onChange={(event) => update("price_unit", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3" /></label></div><label className="block text-sm font-bold">Описание<textarea value={form.description} onChange={(event) => update("description", event.target.value)} className="mt-1 min-h-20 w-full rounded-xl border border-slate-200 p-3" /></label></> : null}
        <section className="rounded-2xl border border-slate-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold">Фотографии</h3>
              <p className="mt-1 text-xs text-slate-500">Выберите несколько фото. Нажмите на звезду у нужного, чтобы сделать его главным.</p>
            </div>
            <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700 hover:border-sky-400 hover:text-sky-600">
              <ImagePlus className="h-4 w-4" />Добавить
              <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => { handleSelectFiles(event.target.files); event.currentTarget.value = ""; }} />
            </label>
          </div>
          {pendingFiles.length > 0 ? (
            <div className="mt-4 grid grid-cols-3 gap-3">
              {pendingFiles.map((file, index) => (
                <div key={`${file.name}-${index}`} className="relative aspect-square overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                  <img src={pendingFilePreviews[index]} alt={file.name} className="h-full w-full object-cover" />
                  <button type="button" onClick={() => setPrimaryPhotoIndex(index)} className={`absolute left-2 top-2 rounded-full p-2 shadow-sm ${primaryPhotoIndex === index ? "bg-amber-400 text-white" : "bg-white/95 text-slate-500"}`} aria-label={primaryPhotoIndex === index ? "Главное фото" : "Сделать главным фото"} title={primaryPhotoIndex === index ? "Главное фото" : "Сделать главным фото"}>
                    <Star className="h-4 w-4" fill={primaryPhotoIndex === index ? "currentColor" : "none"} />
                  </button>
                  <button type="button" onClick={() => removePendingFile(index)} className="absolute right-2 top-2 rounded-full bg-white/95 p-2 text-slate-500 shadow-sm hover:text-rose-600" aria-label="Убрать фото" title="Убрать фото">
                    <Trash2 className="h-4 w-4" />
                  </button>
                  {primaryPhotoIndex === index ? <span className="absolute inset-x-0 bottom-0 bg-slate-900/75 px-2 py-1 text-center text-[10px] font-bold text-white">Главное фото</span> : null}
                </div>
              ))}
            </div>
          ) : <div className="mt-4 rounded-xl border border-dashed border-slate-300 px-3 py-5 text-center text-sm text-slate-500">Фото пока не добавлены</div>}
        </section>
        <button disabled={saving} className="flex w-full items-center justify-center rounded-xl bg-sky-500 py-3 font-bold text-white disabled:opacity-50">{saving ? <Loader2 className="animate-spin" /> : isEditing ? "Сохранить и отправить на модерацию" : "Отправить на модерацию"}</button>
      </form> : null}

      {points.map((point) => {
        const moderationStatus = normalizeModerationStatus(point.moderation_status);
        const waterType = point.water_type.toLowerCase();
        const isApproved = moderationStatus === "approved";
        const isPaidPoint = waterType === "paid";

        return (
          <article key={point.id} className="overflow-hidden rounded-3xl bg-white shadow-sm">
            {point.primary_image_url ? <img className="h-32 w-full object-cover" src={resolveMediaUrl(point.primary_image_url)} alt={point.name || point.source} /> : null}
            <div className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-black">{point.name || point.source}</h2>
                  <p className="text-sm text-slate-500">{point.source}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className={`rounded-full px-2 py-1 text-xs font-bold ${getModerationStatusClass(moderationStatus)}`}>{statusText[moderationStatus] || point.moderation_status}</span>
                  <span className={`rounded-full px-2 py-1 text-xs font-bold ${waterType === "free" ? "bg-blue-100 text-blue-800" : "bg-green-100 text-green-800"}`}>{waterType === "free" ? "Бесплатная вода" : "Платная вода"}</span>
                </div>
              </div>
              <p className="flex gap-2 text-sm text-slate-600"><MapPin className="h-4 w-4 shrink-0" />{point.address || "Адрес не указан — точка задана координатами"}</p>
              {point.phone ? <p className="flex gap-2 text-sm text-slate-600"><Phone className="h-4 w-4" />{point.phone}</p> : null}
              {point.moderation_comment ? <p className="rounded-xl bg-red-50 p-2 text-sm text-red-700">{point.moderation_comment}</p> : null}
              {isPaidPoint && point.price !== null && point.price !== undefined && point.price_unit ? <p className="text-right text-lg font-black text-slate-900">{Number(point.price).toLocaleString("ru-RU")} ₽/{point.price_unit}</p> : null}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => openEditForm(point)} className="flex items-center justify-center gap-2 rounded-xl bg-slate-100 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200"><Pencil className="h-4 w-4" />Редактировать</button>
                <button type="button" onClick={() => setDeleteTarget(point)} className="flex items-center justify-center gap-2 rounded-xl border border-rose-200 py-2 text-sm font-bold text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" />{isApproved ? "Удалить точку" : "Отменить заявку"}</button>
              </div>
            </div>
          </article>
        );
      })}

      {deleteTarget ? <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Удаление точки воды"><div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl"><h2 className="text-lg font-black text-slate-900">{normalizeModerationStatus(deleteTarget.moderation_status) === "approved" ? "Удалить точку?" : "Отменить заявку?"}</h2><p className="mt-2 text-sm text-slate-600">«{deleteTarget.name || deleteTarget.source}» будет полностью удалена вместе с фотографиями. Это действие нельзя отменить.</p><div className="mt-5 grid grid-cols-2 gap-3"><button type="button" disabled={deletingId === deleteTarget.id} onClick={() => setDeleteTarget(null)} className="rounded-xl bg-slate-100 py-3 font-bold text-slate-700 disabled:opacity-50">Назад</button><button type="button" disabled={deletingId === deleteTarget.id} onClick={() => void hardDeletePoint()} className="flex items-center justify-center gap-2 rounded-xl bg-rose-500 py-3 font-bold text-white disabled:opacity-50">{deletingId === deleteTarget.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Удалить</button></div></div></div> : null}
    </div>
  );
}
