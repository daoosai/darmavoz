import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  Droplets,
  ImagePlus,
  Loader2,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Search,
  Star,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import {
  fetch2gisAddressSuggestions,
  get2gisSuggestionAddress,
  get2gisSuggestionCoordinates,
  get2gisSuggestionLabel,
  withTyumenBias,
} from "./addressSearch";
import MapWebGLFallback, {
  load2GisMapSdk,
  tryCreate2GisMap,
} from "./components/MapWebGLFallback";
import { useAuthStore } from "./store";
import {
  baseURL,
  extractApiErrorMessage,
  formatPhoneNumber,
  resolveMediaUrl,
} from "./utils";

interface SepticMedia {
  id: string;
  public_url: string;
  file_name: string;
  is_primary: boolean;
  sort_order?: number | null;
}

interface SepticProfile {
  id: string;
  phone: string;
  address: string;
  lat: number;
  lon: number;
  tank_volume_m3: number;
  service_price: number;
  moderation_status: string;
  moderation_comment?: string | null;
  primary_image_url?: string | null;
  media_files?: SepticMedia[];
}

interface SepticForm {
  phone: string;
  address: string;
  lat: string;
  lon: string;
  tank_volume_m3: string;
  service_price: string;
}

interface AddressSuggestion {
  label: string;
  address: string;
  lat?: number;
  lon?: number;
}

const EMPTY_FORM: SepticForm = {
  phone: "",
  address: "",
  lat: "",
  lon: "",
  tank_volume_m3: "",
  service_price: "",
};

const DEFAULT_MAP_CENTER: [number, number] = [65.527202, 57.152223];

const statusText: Record<string, string> = {
  pending_moderation: "На модерации",
  approved: "Одобрено",
  rejected: "Отклонено",
  suspended: "Приостановлено",
};

const normalizeStatus = (status?: string | null) => status?.toLowerCase() || "";

const statusClass = (status?: string | null) => {
  switch (normalizeStatus(status)) {
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

const optionalText = (value: unknown): string => typeof value === "string" ? value : "";

const normalizeSepticProfile = (profile: SepticProfile): SepticProfile => ({
  ...profile,
  phone: optionalText(profile.phone),
  address: optionalText(profile.address),
  moderation_comment: optionalText(profile.moderation_comment) || null,
  primary_image_url: optionalText(profile.primary_image_url) || null,
  media_files: Array.isArray(profile.media_files) ? profile.media_files : [],
});

const parseCoordinate = (value: string) => {
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizePhoneForApi = (value: string) => {
  let digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  if (!digits.startsWith("7")) digits = `7${digits}`;
  return `+${digits.slice(0, 11)}`;
};

const extractProfilePhone = (profile?: { phone?: unknown; phone_number?: unknown } | null) => {
  for (const value of [profile?.phone, profile?.phone_number]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

interface SepticProviderProfileScreenProps {
  token: string;
  apiPrefix?: string;
}

export default function SepticProviderProfileScreen({
  token,
  apiPrefix = "/equipment-owner",
}: SepticProviderProfileScreenProps) {
  const apiBase = `${baseURL}${apiPrefix}`;
  const currentUser = useAuthStore((state) => state.currentUser);
  const setCurrentUser = useAuthStore((state) => state.setCurrentUser);
  const [profiles, setProfiles] = useState<SepticProfile[]>([]);
  const [form, setForm] = useState<SepticForm>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [editingProfile, setEditingProfile] = useState<SepticProfile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SepticProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [profilePhone, setProfilePhone] = useState(() =>
    formatPhoneNumber(extractProfilePhone(currentUser)),
  );
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isMapUnavailable, setIsMapUnavailable] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingFilePreviews, setPendingFilePreviews] = useState<string[]>([]);
  const [primaryPendingPhotoIndex, setPrimaryPendingPhotoIndex] = useState(0);
  const [existingMedia, setExistingMedia] = useState<SepticMedia[]>([]);
  const [mediaActionId, setMediaActionId] = useState<string | null>(null);
  const addressContainerRef = useRef<HTMLDivElement | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const lastGeocodedAddressRef = useRef("");

  const loadProfiles = async () => {
    const response = await fetch(`${apiBase}/septic-profiles`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => []);
    if (!response.ok) {
      throw new Error(extractApiErrorMessage(data, "Не удалось загрузить объявления септиков"));
    }
    setProfiles(Array.isArray(data) ? data.map((profile) => normalizeSepticProfile(profile as SepticProfile)) : []);
  };

  useEffect(() => {
    void loadProfiles()
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "Не удалось загрузить объявления септиков"),
      )
      .finally(() => setLoading(false));
  }, [apiBase, token]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`${apiBase}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || cancelled) return;
        const phone = extractProfilePhone(data);
        const formattedPhone = formatPhoneNumber(phone);
        setProfilePhone(formattedPhone);
        setCurrentUser({
          id: typeof data.id === "string" ? data.id : currentUser?.id || apiPrefix,
          name:
            typeof data.display_name === "string"
              ? data.display_name
              : currentUser?.name || "",
          phone: phone || null,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiBase, apiPrefix, currentUser?.id, currentUser?.name, setCurrentUser, token]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!addressContainerRef.current?.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const nextPreviews = pendingFiles.map((file) => URL.createObjectURL(file));
    setPendingFilePreviews(nextPreviews);
    return () => nextPreviews.forEach((url) => URL.revokeObjectURL(url));
  }, [pendingFiles]);

  const parsedCoordinates = useMemo(() => {
    const lat = parseCoordinate(form.lat);
    const lon = parseCoordinate(form.lon);
    return lat === null || lon === null ? null : { lat, lon };
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
      markerRef.current?.destroy();
      markerRef.current = null;
      mapRef.current?.destroy();
      mapRef.current = null;
    };
  }, [showForm]);

  useEffect(() => {
    const mapgl = (window as any).mapgl;
    if (!mapRef.current || !mapgl || !parsedCoordinates) return;
    const coordinates: [number, number] = [parsedCoordinates.lon, parsedCoordinates.lat];
    mapRef.current.setCenter(coordinates);
    if (markerRef.current) {
      markerRef.current.setCoordinates(coordinates);
      return;
    }
    markerRef.current = createDraggableMarker(mapRef.current, coordinates);
  }, [parsedCoordinates]);

  const update = (field: keyof SepticForm, value: string) => {
    setForm((current) => ({
      ...current,
      [field]: field === "phone" ? formatPhoneNumber(value) : value,
    }));
  };

  const openCreateForm = () => {
    setEditingProfile(null);
    setForm({ ...EMPTY_FORM, phone: profilePhone });
    setExistingMedia([]);
    setPendingFiles([]);
    setPrimaryPendingPhotoIndex(0);
    setIsMapUnavailable(false);
    lastGeocodedAddressRef.current = "";
    setShowForm(true);
  };

  const openEditForm = (profile: SepticProfile) => {
    setEditingProfile(profile);
    setForm({
      phone: formatPhoneNumber(optionalText(profile.phone)),
      address: optionalText(profile.address),
      lat: stringifyCoordinate(profile.lat),
      lon: stringifyCoordinate(profile.lon),
      tank_volume_m3: String(profile.tank_volume_m3 ?? ""),
      service_price: String(profile.service_price ?? ""),
    });
    setExistingMedia(profile.media_files || []);
    setPendingFiles([]);
    setPrimaryPendingPhotoIndex(0);
    setIsMapUnavailable(false);
    lastGeocodedAddressRef.current = optionalText(profile.address).trim().toLowerCase();
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingProfile(null);
    setPendingFiles([]);
    setExistingMedia([]);
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
      return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось определить координаты по адресу");
      return null;
    } finally {
      setIsGeocoding(false);
    }
  };

  const handleAddressChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const address = event.target.value;
    lastGeocodedAddressRef.current = "";
    update("address", address);
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
    update("address", address);
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

  const uploadSepticPhoto = async (
    profileId: string,
    file: File,
    isPrimary: boolean,
    sortOrder: number,
  ): Promise<SepticMedia> => {
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    const presignResponse = await fetch(`${baseURL}/media/presign-upload`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        entity_type: "septic_profile",
        entity_id: profileId,
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
    if (!uploadResponse.ok) throw new Error("Не удалось загрузить фотографию в хранилище");
    const confirmResponse = await fetch(`${baseURL}/media/confirm`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        entity_type: "septic_profile",
        entity_id: profileId,
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
      throw new Error(extractApiErrorMessage(confirmed, "Не удалось подтвердить загрузку фото"));
    }
    return confirmed.media_file as SepticMedia;
  };

  const handleSelectFiles = (files: FileList | null) => {
    const images = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) {
      toast.error("Выберите файл изображения.");
      return;
    }
    setPendingFiles((current) => [...current, ...images]);
  };

  const removePendingFile = (index: number) => {
    setPendingFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
    setPrimaryPendingPhotoIndex((current) => {
      if (index < current) return current - 1;
      return index === current ? Math.max(0, current - 1) : current;
    });
  };

  const makeExistingPhotoPrimary = async (media: SepticMedia) => {
    setMediaActionId(media.id);
    try {
      const response = await fetch(`${baseURL}/media/${media.id}/make-primary`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось выбрать главное фото"));
      setExistingMedia((current) => current.map((item) => ({ ...item, is_primary: item.id === media.id })));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось выбрать главное фото");
    } finally {
      setMediaActionId(null);
    }
  };

  const deleteExistingPhoto = async (media: SepticMedia) => {
    setMediaActionId(media.id);
    try {
      const response = await fetch(`${baseURL}/media/${media.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось удалить фото"));
      setExistingMedia((current) => current.filter((item) => item.id !== media.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить фото");
    } finally {
      setMediaActionId(null);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const address = optionalText(form.address).trim();
    const phone = normalizePhoneForApi(form.phone);
    let lat = parseCoordinate(form.lat);
    let lon = parseCoordinate(form.lon);
    if (!address) {
      toast.error("Укажите адрес оказания услуги.");
      return;
    }
    if (phone.length !== 12) {
      toast.error("Введите телефон в формате +7 (999) 999-99-99.");
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
    const tankVolume = Number(form.tank_volume_m3);
    const servicePrice = Number(form.service_price);
    if (!Number.isFinite(tankVolume) || tankVolume <= 0 || !Number.isFinite(servicePrice) || servicePrice <= 0) {
      toast.error("Укажите корректные объём цистерны и стоимость услуги.");
      return;
    }

    const profileBeingEdited = editingProfile;
    let savedProfile: SepticProfile | null = null;
    setSaving(true);
    try {
      const response = await fetch(
        profileBeingEdited
          ? `${apiBase}/septic-profiles/${profileBeingEdited.id}`
          : `${apiBase}/septic-profiles`,
        {
          method: profileBeingEdited ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            phone,
            address,
            lat,
            lon,
            tank_volume_m3: tankVolume,
            service_price: servicePrice,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось сохранить объявление"));
      const normalizedProfile = normalizeSepticProfile(data as SepticProfile);
      savedProfile = normalizedProfile;
      setProfiles((current) => {
        const withoutSavedProfile = current.filter((profile) => profile.id !== normalizedProfile.id);
        return profileBeingEdited
          ? current.map((profile) => profile.id === normalizedProfile.id ? normalizedProfile : profile)
          : [normalizedProfile, ...withoutSavedProfile];
      });

      const uploadedMedia: SepticMedia[] = [];
      for (const [index, file] of pendingFiles.entries()) {
        uploadedMedia.push(
          await uploadSepticPhoto(
            savedProfile.id,
            file,
            index === primaryPendingPhotoIndex,
            existingMedia.length + index,
          ),
        );
      }
      toast.success(
        profileBeingEdited
          ? "Изменения септика отправлены на модерацию."
          : "Заявка на откачку септика отправлена на модерацию.",
      );
      setExistingMedia([...existingMedia, ...uploadedMedia]);
      closeForm();
      await loadProfiles();
    } catch (error) {
      if (savedProfile && !profileBeingEdited && pendingFiles.length > 0) {
        await fetch(`${apiBase}/septic-profile/${savedProfile.id}/hard`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => undefined);
      }
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить объявление");
    } finally {
      setSaving(false);
    }
  };

  const hardDeleteProfile = async () => {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget.id);
    try {
      const response = await fetch(
        `${apiBase}/septic-profile/${deleteTarget.id}/hard`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось удалить объявление"));
      setDeleteTarget(null);
      await loadProfiles();
      toast.success("Объявление и его фотографии полностью удалены.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить объявление");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return <Loader2 className="mx-auto mt-20 h-8 w-8 animate-spin text-sky-500" />;
  }

  return (
    <div className="space-y-4 px-4 pb-24 pt-[max(env(safe-area-inset-top),2.5rem)]">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded-2xl bg-sky-100 p-3 text-sky-600"><Droplets /></span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-black text-slate-900">Услуги по откачке септиков</h1>
            <p className="text-sm text-slate-500">Ваши машины и объявления</p>
          </div>
        </div>
        {!showForm ? (
          <button type="button" onClick={openCreateForm} className="rounded-xl bg-sky-500 p-3 text-white shadow-sm" aria-label="Добавить септик">
            <Plus className="h-5 w-5" />
          </button>
        ) : null}
      </header>

      {showForm ? (
        <form onSubmit={submit} className="space-y-4 rounded-3xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-black text-slate-900">{editingProfile ? "Редактирование септика" : "Новый септик"}</h2>
            <button type="button" onClick={closeForm} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label="Закрыть форму" title="Закрыть">
              <X className="h-5 w-5" />
            </button>
          </div>

          <label className="block text-sm font-bold text-slate-800">
            Телефон <span className="text-red-500">*</span>
            <span className="mt-1 flex items-center gap-2 rounded-xl border border-slate-200 px-3 focus-within:border-sky-500">
              <Phone className="h-4 w-4 text-slate-400" />
              <input required type="tel" inputMode="tel" autoComplete="tel" maxLength={18} value={form.phone} onChange={(event) => update("phone", event.target.value)} placeholder="+7 (999) 999-99-99" className="w-full py-3 outline-none" />
            </span>
          </label>

          <section className="space-y-2">
            <label className="block text-sm font-bold text-slate-800" htmlFor="septic-address">Адрес <span className="text-red-500">*</span></label>
            <div ref={addressContainerRef} className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input id="septic-address" required value={form.address} onFocus={() => setShowSuggestions(true)} onChange={handleAddressChange} placeholder="Начните вводить адрес" className="w-full rounded-xl border border-slate-200 py-3 pl-10 pr-3 outline-none focus:border-sky-500" />
              {showSuggestions && suggestions.length > 0 ? (
                <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  {suggestions.map((suggestion, index) => (
                    <button key={`${suggestion.address}-${index}`} type="button" onMouseDown={(event) => { event.preventDefault(); void selectSuggestion(suggestion); }} className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-sky-50">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
                      <span>{suggestion.label}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              {isMapUnavailable ? <MapWebGLFallback className="h-52" /> : <div ref={mapContainerRef} className="h-52 w-full" />}
            </div>
            <p className="text-xs text-slate-500">
              {isGeocoding
                ? "Определяем координаты…"
                : parsedCoordinates
                  ? `Координаты выбраны: ${parsedCoordinates.lat.toFixed(6)}, ${parsedCoordinates.lon.toFixed(6)}`
                  : "Выберите адрес из подсказок или укажите точку на карте."}
            </p>
          </section>

          <div className="grid grid-cols-2 gap-4">
            <label className="text-sm font-bold text-slate-800">
              <span className="flex items-center gap-1 whitespace-nowrap">Объём цистерны, м³ <span className="text-red-500">*</span></span>
              <input required type="number" min="0.1" step="0.1" value={form.tank_volume_m3} onChange={(event) => update("tank_volume_m3", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3 outline-none focus:border-sky-500" />
            </label>
            <label className="text-sm font-bold text-slate-800">
              <span className="flex items-center gap-1 whitespace-nowrap">Стоимость, ₽ <span className="text-red-500">*</span></span>
              <span className="mt-1 flex items-center gap-1 rounded-xl border border-slate-200 px-3 focus-within:border-sky-500"><Wallet className="h-4 w-4 text-slate-400" /><input required type="number" min="1" step="1" value={form.service_price} onChange={(event) => update("service_price", event.target.value)} className="min-w-0 w-full py-3 outline-none" /></span>
            </label>
          </div>

          <section className="rounded-2xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="text-sm font-bold text-slate-900">Фотографии</h3><p className="mt-1 text-xs text-slate-500">Добавьте несколько фото. Нажмите звезду у нужного фото, чтобы сделать его главным.</p></div>
              <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700 hover:border-sky-400 hover:text-sky-600"><ImagePlus className="h-4 w-4" />Добавить<input type="file" accept="image/*" multiple className="hidden" onChange={(event) => { handleSelectFiles(event.target.files); event.currentTarget.value = ""; }} /></label>
            </div>
            {existingMedia.length > 0 || pendingFiles.length > 0 ? (
              <div className="mt-4 grid grid-cols-3 gap-3">
                {existingMedia.map((media) => (
                  <div key={media.id} className="relative aspect-square overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                    <img src={resolveMediaUrl(media.public_url)} alt={media.file_name} className="h-full w-full object-cover" />
                    <button type="button" disabled={mediaActionId === media.id} onClick={() => void makeExistingPhotoPrimary(media)} className={`absolute left-2 top-2 rounded-full p-2 shadow-sm disabled:opacity-50 ${media.is_primary ? "bg-amber-400 text-white" : "bg-white/95 text-slate-500"}`} aria-label="Сделать главным фото"><Star className="h-4 w-4" fill={media.is_primary ? "currentColor" : "none"} /></button>
                    <button type="button" disabled={mediaActionId === media.id} onClick={() => void deleteExistingPhoto(media)} className="absolute right-2 top-2 rounded-full bg-white/95 p-2 text-slate-500 shadow-sm hover:text-rose-600 disabled:opacity-50" aria-label="Удалить фото"><Trash2 className="h-4 w-4" /></button>
                    {media.is_primary ? <span className="absolute inset-x-0 bottom-0 bg-slate-900/75 px-2 py-1 text-center text-[10px] font-bold text-white">Главное фото</span> : null}
                  </div>
                ))}
                {pendingFiles.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="relative aspect-square overflow-hidden rounded-2xl border border-dashed border-sky-300 bg-sky-50">
                    <img src={pendingFilePreviews[index]} alt={file.name} className="h-full w-full object-cover" />
                    <button type="button" onClick={() => setPrimaryPendingPhotoIndex(index)} className={`absolute left-2 top-2 rounded-full p-2 shadow-sm ${primaryPendingPhotoIndex === index ? "bg-amber-400 text-white" : "bg-white/95 text-slate-500"}`} aria-label="Сделать главным фото"><Star className="h-4 w-4" fill={primaryPendingPhotoIndex === index ? "currentColor" : "none"} /></button>
                    <button type="button" onClick={() => removePendingFile(index)} className="absolute right-2 top-2 rounded-full bg-white/95 p-2 text-slate-500 shadow-sm hover:text-rose-600" aria-label="Убрать фото"><Trash2 className="h-4 w-4" /></button>
                    {primaryPendingPhotoIndex === index ? <span className="absolute inset-x-0 bottom-0 bg-sky-600/85 px-2 py-1 text-center text-[10px] font-bold text-white">Будет главным</span> : null}
                  </div>
                ))}
              </div>
            ) : <div className="mt-4 rounded-xl border border-dashed border-slate-300 px-3 py-5 text-center text-sm text-slate-500">Фотографии пока не добавлены</div>}
          </section>

          <button disabled={saving} className="flex w-full items-center justify-center rounded-xl bg-sky-500 py-3 font-bold text-white shadow-sm disabled:opacity-50">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : editingProfile ? "Сохранить и отправить на модерацию" : "Отправить на модерацию"}
          </button>
        </form>
      ) : profiles.length === 0 ? (
        <div className="rounded-3xl bg-white px-5 py-10 text-center shadow-sm"><Droplets className="mx-auto h-10 w-10 text-sky-400" /><h2 className="mt-3 font-black text-slate-900">Объявлений пока нет</h2><p className="mt-1 text-sm text-slate-500">Добавьте машину для услуг по откачке септиков.</p><button type="button" onClick={openCreateForm} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-3 font-bold text-white"><Plus className="h-4 w-4" />Добавить септик</button></div>
      ) : (
        profiles.map((profile) => {
          const status = normalizeStatus(profile.moderation_status);
          const approved = status === "approved";
          const mainImage = profile.primary_image_url || profile.media_files?.find((media) => media.is_primary)?.public_url;
          return <article key={profile.id} className="overflow-hidden rounded-3xl bg-white shadow-sm">
            {mainImage ? <img src={resolveMediaUrl(mainImage)} alt={profile.address} className="h-36 w-full object-cover" /> : <div className="flex h-28 items-center justify-center bg-sky-50 text-sky-400"><Droplets className="h-9 w-9" /></div>}
            <div className="space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="font-black text-slate-900">Откачка септика</h2><p className="mt-1 flex gap-2 text-sm text-slate-600"><MapPin className="h-4 w-4 shrink-0" />{profile.address}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${statusClass(status)}`}>{statusText[status] || profile.moderation_status}</span></div><p className="flex gap-2 text-sm text-slate-600"><Phone className="h-4 w-4" />{formatPhoneNumber(profile.phone)}</p>{profile.moderation_comment ? <p className="rounded-xl bg-red-50 p-2 text-sm text-red-700">{profile.moderation_comment}</p> : null}<div className="flex items-end justify-between gap-3"><p className="text-sm font-semibold text-slate-600">Объём: {Number(profile.tank_volume_m3).toLocaleString("ru-RU")} м³</p><p className="text-lg font-black text-slate-900">{Number(profile.service_price).toLocaleString("ru-RU")} ₽</p></div><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => openEditForm(profile)} className="flex items-center justify-center gap-2 rounded-xl bg-slate-100 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200"><Pencil className="h-4 w-4" />Редактировать</button><button type="button" onClick={() => setDeleteTarget(profile)} className="flex items-center justify-center gap-2 rounded-xl border border-rose-200 py-2 text-sm font-bold text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" />{approved ? "Удалить объявление" : "Отменить заявку"}</button></div></div>
          </article>;
        })
      )}

      {deleteTarget ? <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" role="dialog" aria-modal="true"><div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl"><h2 className="text-lg font-black text-slate-900">{normalizeStatus(deleteTarget.moderation_status) === "approved" ? "Удалить объявление?" : "Отменить заявку?"}</h2><p className="mt-2 text-sm text-slate-600">Объявление и прикреплённые фотографии будут полностью удалены. Это действие нельзя отменить.</p><div className="mt-5 grid grid-cols-2 gap-3"><button type="button" disabled={deletingId === deleteTarget.id} onClick={() => setDeleteTarget(null)} className="rounded-xl bg-slate-100 py-3 font-bold text-slate-700">Назад</button><button type="button" disabled={deletingId === deleteTarget.id} onClick={() => void hardDeleteProfile()} className="flex items-center justify-center gap-2 rounded-xl bg-rose-500 py-3 font-bold text-white disabled:opacity-50">{deletingId === deleteTarget.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Удалить</button></div></div></div> : null}
    </div>
  );
}
