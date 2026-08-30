import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MapPin, Search } from "lucide-react";
import toast from "react-hot-toast";

import {
  fetch2gisAddressSuggestions,
  get2gisSuggestionAddress,
  get2gisSuggestionCoordinates,
  get2gisSuggestionLabel,
  withTyumenBias,
} from "../addressSearch";
import MapWebGLFallback, {
  load2GisMapSdk,
  tryCreate2GisMap,
} from "./MapWebGLFallback";
import { baseURL, extractApiErrorMessage } from "../utils";

interface LocationValue {
  address: string;
  lat: string;
  lon: string;
}

interface AddressSuggestion {
  label: string;
  address: string;
  lat?: number;
  lon?: number;
}

interface Props extends LocationValue {
  token: string | null;
  inputId: string;
  onChange: (value: LocationValue) => void;
  addressRequired?: boolean;
}

const DEFAULT_CENTER: [number, number] = [65.534328, 57.152286];

const stringifyCoordinate = (value: number) => String(Number(value.toFixed(7)));

const parseCoordinates = (lat: string, lon: string) => {
  if (!lat.trim() || !lon.trim()) return null;
  const nextLat = Number(lat);
  const nextLon = Number(lon);
  return Number.isFinite(nextLat) && Number.isFinite(nextLon)
    ? { lat: nextLat, lon: nextLon }
    : null;
};

export default function AddressMapPicker({
  address,
  lat,
  lon,
  token,
  inputId,
  onChange,
  addressRequired = true,
}: Props) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const addressContainerRef = useRef<HTMLDivElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef<LocationValue>({ address, lat, lon });
  const requestIdRef = useRef(0);
  const coordinates = useMemo(() => parseCoordinates(lat, lon), [lat, lon]);
  const coordinatesRef = useRef(coordinates);
  coordinatesRef.current = coordinates;
  onChangeRef.current = onChange;
  valueRef.current = { address, lat, lon };

  const updateCoordinates = (nextLat: number, nextLon: number) => {
    const currentValue = valueRef.current;
    onChangeRef.current({
      address: currentValue.address,
      lat: stringifyCoordinate(nextLat),
      lon: stringifyCoordinate(nextLon),
    });
  };

  const createDraggableMarker = (mapInstance: any, markerCoordinates: [number, number]) => {
    const mapgl = (window as any).mapgl;
    const marker = new mapgl.Marker(mapInstance, { coordinates: markerCoordinates, draggable: true });
    marker.on("dragend", (event: any) => {
      const [nextLon, nextLat] = event.target.getCoordinates();
      if (Number.isFinite(nextLat) && Number.isFinite(nextLon)) {
        updateCoordinates(nextLat, nextLon);
      }
    });
    return marker;
  };

  useEffect(() => {
    let disposed = false;
    const key = import.meta.env.VITE_2GIS_KEY;
    if (!key || !mapContainerRef.current || mapRef.current) {
      if (!key) setMapUnavailable(true);
      return;
    }

    void load2GisMapSdk()
      .then((mapgl) => {
        if (disposed || !mapContainerRef.current || mapRef.current) return;
        const initialCoordinates = coordinatesRef.current;
        const mapInstance = tryCreate2GisMap(
          () => new mapgl.Map(mapContainerRef.current, {
            center: initialCoordinates ? [initialCoordinates.lon, initialCoordinates.lat] : DEFAULT_CENTER,
            zoom: 12,
            key,
          }),
          () => setMapUnavailable(true),
        );
        if (!mapInstance) return;
        if (disposed) {
          mapInstance.destroy();
          return;
        }
        mapInstance.on("click", (event: any) => {
          const [nextLon, nextLat] = event?.lngLat || [];
          if (Number.isFinite(nextLat) && Number.isFinite(nextLon)) {
            updateCoordinates(nextLat, nextLon);
          }
        });
        mapRef.current = mapInstance;
        if (initialCoordinates) {
          markerRef.current = createDraggableMarker(mapInstance, [initialCoordinates.lon, initialCoordinates.lat]);
        }
      })
      .catch(() => !disposed && setMapUnavailable(true));

    return () => {
      disposed = true;
      markerRef.current?.destroy();
      markerRef.current = null;
      mapRef.current?.destroy();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const mapgl = (window as any).mapgl;
    if (!mapRef.current || !mapgl || !coordinates) return;
    const nextCoordinates: [number, number] = [coordinates.lon, coordinates.lat];
    mapRef.current.setCenter(nextCoordinates);
    if (markerRef.current) {
      markerRef.current.setCoordinates(nextCoordinates);
      return;
    }
    markerRef.current = createDraggableMarker(mapRef.current, nextCoordinates);
  }, [coordinates]);

  const geocodeAddress = async (nextAddress: string) => {
    setIsGeocoding(true);
    try {
      const response = await fetch(
        `${baseURL}/geo/geocode?address=${encodeURIComponent(withTyumenBias(nextAddress))}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data, "Не удалось определить координаты по адресу"));
      }
      const nextLat = Number(data.lat);
      const nextLon = Number(data.lon);
      if (Number.isFinite(nextLat) && Number.isFinite(nextLon)) {
        return { lat: nextLat, lon: nextLon };
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось определить координаты по адресу");
    } finally {
      setIsGeocoding(false);
    }
    return null;
  };

  const handleAddressChange = async (nextAddress: string) => {
    onChange({ address: nextAddress, lat: "", lon: "" });
    setShowSuggestions(true);
    const requestId = ++requestIdRef.current;
    if (!nextAddress.trim()) {
      setSuggestions([]);
      return;
    }
    const items = await fetch2gisAddressSuggestions(nextAddress);
    if (requestId !== requestIdRef.current) return;
    setSuggestions(
      items
        .map((item: any) => {
          const suggestionAddress = get2gisSuggestionAddress(item);
          const label = get2gisSuggestionLabel(item);
          const suggestionCoordinates = get2gisSuggestionCoordinates(item);
          return { label: label || suggestionAddress, address: suggestionAddress, ...suggestionCoordinates };
        })
        .filter((item) => Boolean(item.address)),
    );
  };

  const selectSuggestion = async (suggestion: AddressSuggestion) => {
    const nextAddress = suggestion.address.trim() || suggestion.label.trim();
    setShowSuggestions(false);
    setSuggestions([]);
    if (typeof suggestion.lat === "number" && typeof suggestion.lon === "number") {
      onChange({
        address: nextAddress,
        lat: stringifyCoordinate(suggestion.lat),
        lon: stringifyCoordinate(suggestion.lon),
      });
      return;
    }
    onChange({ address: nextAddress, lat, lon });
    const result = await geocodeAddress(nextAddress);
    if (result) {
      onChange({
        address: nextAddress,
        lat: stringifyCoordinate(result.lat),
        lon: stringifyCoordinate(result.lon),
      });
    }
  };

  const handleAddressBlur = async () => {
    const nextAddress = address.trim();
    if (!nextAddress || coordinates) return;
    const result = await geocodeAddress(nextAddress);
    if (result) {
      onChange({
        address: nextAddress,
        lat: stringifyCoordinate(result.lat),
        lon: stringifyCoordinate(result.lon),
      });
    }
  };

  return (
    <section className="space-y-2">
      <label className="block text-sm font-bold text-slate-800" htmlFor={inputId}>
        Адрес {addressRequired ? <span className="text-red-500">*</span> : <span className="font-normal text-slate-400">(необязательно, если указаны координаты)</span>}
      </label>
      <div ref={addressContainerRef} className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input
          id={inputId}
          required={addressRequired && !coordinates}
          value={address}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => void handleAddressBlur()}
          onChange={(event) => void handleAddressChange(event.target.value)}
          placeholder="Начните вводить адрес"
          className="w-full rounded-xl border border-slate-200 py-3 pl-10 pr-3 outline-none focus:border-sky-500"
        />
        {showSuggestions && suggestions.length > 0 ? (
          <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
            {suggestions.map((suggestion, index) => (
              <button
                key={`${suggestion.address}-${index}`}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  void selectSuggestion(suggestion);
                }}
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-sky-50"
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
                <span>{suggestion.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-bold text-slate-800">
          Широта
          <input
            type="number"
            min="-90"
            max="90"
            step="any"
            required={addressRequired || !address.trim()}
            value={lat}
            onChange={(event) => onChange({ address, lat: event.target.value, lon })}
            placeholder="Например, 57.152286"
            className="mt-1 w-full rounded-xl border border-slate-200 p-3 font-normal outline-none focus:border-sky-500"
          />
        </label>
        <label className="block text-sm font-bold text-slate-800">
          Долгота
          <input
            type="number"
            min="-180"
            max="180"
            step="any"
            required={addressRequired || !address.trim()}
            value={lon}
            onChange={(event) => onChange({ address, lat, lon: event.target.value })}
            placeholder="Например, 65.534328"
            className="mt-1 w-full rounded-xl border border-slate-200 p-3 font-normal outline-none focus:border-sky-500"
          />
        </label>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        {mapUnavailable ? <MapWebGLFallback className="h-52" /> : <div ref={mapContainerRef} className="h-52 w-full" />}
      </div>
      <p className="flex min-h-5 items-center gap-1 text-xs text-slate-500">
        {isGeocoding ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Определяем координаты…</> : coordinates ? `Координаты: ${coordinates.lat.toFixed(6)}, ${coordinates.lon.toFixed(6)}` : "Выберите адрес из подсказок или отметьте точку на карте"}
      </p>
    </section>
  );
}
