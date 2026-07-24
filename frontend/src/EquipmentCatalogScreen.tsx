import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Headphones, ImageIcon, MapPin, Wrench, X } from "lucide-react";
import toast from "react-hot-toast";

import { fetch2gisAddressSuggestions, withTyumenBias } from "./addressSearch";
import SupportScreen from "./SupportScreen";
import { useAddressStore, useAuthStore } from "./store";
import { baseURL, extractApiErrorMessage, resolveMediaUrl } from "./utils";

export interface EquipmentTypeItem {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  sort_order: number;
}

export interface EquipmentTariff {
  type: "hour" | "shift";
  price: number | null;
  hours?: number | null;
}

export interface EquipmentListing {
  id: string;
  equipment_type: string;
  equipment_type_id?: string | null;
  equipment_type_name: string;
  title: string;
  description: string;
  tariffs?: EquipmentTariff[];
  price_amount?: number | null;
  price_unit?: "hour" | "shift" | "day" | "negotiable";
  city?: string | null;
  district?: string | null;
  is_active: boolean;
  sort_order: number;
  primary_image_url?: string | null;
  media_files?: { id: string; public_url: string; is_primary?: boolean }[];
  owner_user_id?: string | null;
  owner_name?: string | null;
  owner_phone?: string | null;
  moderation_status?: "incomplete" | "pending_moderation" | "approved" | "rejected" | "suspended";
  moderation_comment?: string | null;
}

interface EquipmentApplicationSummary {
  id: string;
  listing_id: string;
  status: "new" | "in_progress" | "closed" | "completed" | "rejected" | "cancelled";
}

interface ClientAddress {
  id?: string;
  address?: string;
  full_address: string;
  lat?: number | null;
  lon?: number | null;
  comment?: string | null;
  is_default?: boolean;
}

interface Props {
  onOpenAuth: () => void;
}

const DEFAULT_MAP_CENTER: [number, number] = [65.534328, 57.152286];
const MANUAL_ADDRESS_OPTION = "__manual__";

const getSuggestionLabel = (item: any) =>
  item?.search_attributes?.suggested_text || item?.full_name || item?.name || "";

const getClientAddressKey = (address: ClientAddress) =>
  address.id || address.full_address || address.address || "";

export const getEquipmentTariffs = (item: EquipmentListing): EquipmentTariff[] => {
  if (item.tariffs?.length) return item.tariffs;
  if (item.price_amount == null || item.price_unit === "negotiable") {
    return [{ type: "hour", price: null }];
  }
  if (item.price_unit === "shift") {
    return [
      { type: "hour", price: Number(item.price_amount) },
      { type: "shift", hours: 1, price: Number(item.price_amount) },
    ];
  }
  return [{ type: "hour", price: Number(item.price_amount) }];
};

const isConfiguredEquipmentTariff = (tariff: EquipmentTariff) =>
  tariff.price != null && Number.isFinite(Number(tariff.price)) && Number(tariff.price) > 0;

export const hasConfiguredEquipmentTariffs = (item: EquipmentListing) =>
  getEquipmentTariffs(item).some(isConfiguredEquipmentTariff);

export const formatEquipmentPrice = (item: EquipmentListing) => {
  const tariffs = getEquipmentTariffs(item);
  const hourTariff = tariffs.find((tariff) => tariff.type === "hour");
  const shiftTariff = tariffs.find((tariff) => tariff.type === "shift");
  if (hourTariff?.price == null) return "Цена договорная";
  const hourLabel = `${Number(hourTariff.price).toLocaleString("ru-RU")} ₽/час`;
  return shiftTariff?.price != null
    ? `${hourLabel} · ${Number(shiftTariff.price).toLocaleString("ru-RU")} ₽/смена`
    : hourLabel;
};

export default function EquipmentCatalogScreen({ onOpenAuth }: Props) {
  const { token, role } = useAuthStore();
  const { selectedAddress, setSelectedAddress } = useAddressStore();
  const [types, setTypes] = useState<EquipmentTypeItem[]>([]);
  const [listings, setListings] = useState<EquipmentListing[]>([]);
  const [applications, setApplications] = useState<EquipmentApplicationSummary[]>([]);
  const [selectedType, setSelectedType] = useState("");
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("");
  const [selected, setSelected] = useState<EquipmentListing | null>(null);
  const [showApplication, setShowApplication] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [waitingForAuth, setWaitingForAuth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<any[]>([]);
  const [addressSelected, setAddressSelected] = useState(false);
  const [selectedAddressCoords, setSelectedAddressCoords] = useState<[number, number] | null>(null);
  const [clientAddresses, setClientAddresses] = useState<ClientAddress[]>([]);
  const [clientAddressesLoading, setClientAddressesLoading] = useState(false);
  const [addressMode, setAddressMode] = useState<"saved" | "new">("new");
  const [selectedSavedAddressId, setSelectedSavedAddressId] = useState<string | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [form, setForm] = useState({
    object_address: "",
    requested_date: "",
    requested_time: "",
    duration_value: "1",
    duration_unit: "hours",
    contact_phone: "",
    comment: "",
  });

  const load = async () => {
    setLoading(true);
    try {
      const [typesResponse, listingsResponse] = await Promise.all([
        fetch(`${baseURL}/equipment/types`),
        fetch(`${baseURL}/equipment`),
      ]);
      if (!typesResponse.ok || !listingsResponse.ok) {
        throw new Error("catalog");
      }
      const loadedTypes: EquipmentTypeItem[] = await typesResponse.json();
      setTypes(loadedTypes.filter((item) => item.is_active));
      setListings(await listingsResponse.json());
    } catch {
      toast.error("Не удалось загрузить каталог спецтехники");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!token || role !== "client") {
      setApplications([]);
      return;
    }

    fetch(`${baseURL}/client/equipment-applications`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error("applications")),
      )
      .then((data: EquipmentApplicationSummary[]) => setApplications(data))
      .catch(() => setApplications([]));
  }, [token, role]);

  useEffect(() => {
    if (waitingForAuth && token && role === "client") {
      setWaitingForAuth(false);
      setShowApplication(true);
    }
  }, [waitingForAuth, token, role]);

  useEffect(() => {
    if (!selected) return;

    const tariffs = getEquipmentTariffs(selected);
    const desiredType = form.duration_unit === "hours" ? "hour" : "shift";
    if (!tariffs.some((tariff) => tariff.type === desiredType)) {
      setForm((previous) => ({
        ...previous,
        duration_unit: tariffs[0]?.type === "shift" ? "shifts" : "hours",
      }));
    }
  }, [selected?.id]);

  useEffect(() => {
    if (!showApplication || !token || role !== "client" || form.contact_phone) return;

    fetch(`${baseURL}/clients/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((client) => {
        if (client?.phone) {
          setForm((previous) => ({ ...previous, contact_phone: client.phone }));
        }
      })
      .catch(() => undefined);
  }, [showApplication, token, role, form.contact_phone]);

  useEffect(() => {
    if (
      !showApplication ||
      addressMode !== "new" ||
      addressSelected ||
      form.object_address.trim().length < 3
    ) {
      setAddressSuggestions([]);
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      void fetch2gisAddressSuggestions(form.object_address).then((items) => {
        if (!active) return;
        setAddressSuggestions(items.filter((item) => getSuggestionLabel(item)));
      });
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [showApplication, form.object_address, addressSelected, addressMode]);

  useEffect(() => {
    if (!showApplication || !token || role !== "client") return;

    const loadClientAddresses = async () => {
      setClientAddressesLoading(true);
      try {
        const response = await fetch(`${baseURL}/client/addresses`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = response.ok ? await response.json() : [];
        const addressList: ClientAddress[] = Array.isArray(data) ? data : data.results || [];
        setClientAddresses(addressList);

        if (addressList.length === 0) {
          setAddressMode("new");
          setSelectedSavedAddressId(null);
          return;
        }

        const fallbackAddress =
          (selectedAddress
            ? addressList.find((item) => item.full_address === selectedAddress)
            : null) ||
          addressList.find((item) => item.is_default) ||
          addressList[0];

        if (!fallbackAddress) {
          setAddressMode("new");
          setSelectedSavedAddressId(null);
          return;
        }

        const addressLabel = fallbackAddress.full_address || fallbackAddress.address || "";
        setAddressMode("saved");
        setSelectedSavedAddressId(getClientAddressKey(fallbackAddress));
        setAddressSelected(true);
        setAddressSuggestions([]);
        setForm((previous) => ({ ...previous, object_address: addressLabel }));
        if (addressLabel) {
          setSelectedAddress(addressLabel);
        }
        try {
          await resolveAddressCoordinates(addressLabel, fallbackAddress);
        } catch {
          setSelectedAddressCoords(null);
        }
      } catch {
        setClientAddresses([]);
        setAddressMode("new");
        setSelectedSavedAddressId(null);
      } finally {
        setClientAddressesLoading(false);
      }
    };

    void loadClientAddresses();
  }, [showApplication, token, role, selectedAddress, setSelectedAddress]);

  useEffect(() => {
    if (!showApplication || !(window as any).mapgl || mapRef.current) {
      return;
    }

    const container = document.getElementById("equipment-application-map");
    if (!container) return;

    const map = new (window as any).mapgl.Map("equipment-application-map", {
      center: selectedAddressCoords || DEFAULT_MAP_CENTER,
      zoom: selectedAddressCoords ? 15 : 12,
      key: import.meta.env.VITE_2GIS_KEY,
    });

    mapRef.current = map;

    if (selectedAddressCoords) {
      markerRef.current = new (window as any).mapgl.Marker(map, {
        coordinates: selectedAddressCoords,
      });
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
  }, [showApplication]);

  useEffect(() => {
    if (!mapRef.current) return;

    if (!selectedAddressCoords) {
      if (markerRef.current) {
        markerRef.current.destroy();
        markerRef.current = null;
      }
      mapRef.current.setCenter(DEFAULT_MAP_CENTER);
      mapRef.current.setZoom(12);
      return;
    }

    mapRef.current.setCenter(selectedAddressCoords);
    mapRef.current.setZoom(15);

    if (markerRef.current) {
      markerRef.current.setCoordinates(selectedAddressCoords);
      return;
    }

    markerRef.current = new (window as any).mapgl.Marker(mapRef.current, {
      coordinates: selectedAddressCoords,
    });
  }, [selectedAddressCoords]);

  const cities = useMemo(
    () => Array.from(new Set(listings.map((item) => item.city).filter(Boolean) as string[])).sort(),
    [listings],
  );

  const filtered = listings.filter((item) => {
    const matchesType = !selectedType || item.equipment_type_id === selectedType;
    const matchesCity = !city || item.city === city;
    const query = search.trim().toLowerCase();
    const matchesSearch =
      !query || `${item.title} ${item.description}`.toLowerCase().includes(query);
    return matchesType && matchesCity && matchesSearch;
  });

  const activeApplicationListingIds = useMemo(
    () =>
      new Set(
        applications
          .filter((item) => item.status === "new" || item.status === "in_progress")
          .map((item) => item.listing_id),
      ),
    [applications],
  );

  const selectedTariffs = selected
    ? getEquipmentTariffs(selected).filter(isConfiguredEquipmentTariff)
    : [];
  const selectedTariff = selectedTariffs.find(
    (tariff) => tariff.type === (form.duration_unit === "hours" ? "hour" : "shift"),
  );
  const calculatedTotal =
    selectedTariff?.price == null
      ? null
      : Number(form.duration_value || 0) * Number(selectedTariff.price);
  const selectedHasConfiguredTariffs = selected ? hasConfiguredEquipmentTariffs(selected) : false;

  const resetApplicationMeta = () => {
    setClientAddresses([]);
    setClientAddressesLoading(false);
    setAddressMode("new");
    setSelectedSavedAddressId(null);
    setAddressSuggestions([]);
    setAddressSelected(false);
    setSelectedAddressCoords(null);
  };

  const startApplication = () => {
    if (selected && (activeApplicationListingIds.has(selected.id) || !hasConfiguredEquipmentTariffs(selected))) {
      return;
    }
    if (!token || role !== "client") {
      setWaitingForAuth(true);
      onOpenAuth();
      return;
    }
    resetApplicationMeta();
    setShowApplication(true);
  };

  const resolveAddressCoordinates = async (address: string, item?: any) => {
    const itemLat = Number(item?.point?.lat);
    const itemLon = Number(item?.point?.lon);
    if (Number.isFinite(itemLat) && Number.isFinite(itemLon)) {
      setSelectedAddressCoords([itemLon, itemLat]);
      return;
    }

    const directLat = Number(item?.lat);
    const directLon = Number(item?.lon);
    if (Number.isFinite(directLat) && Number.isFinite(directLon)) {
      setSelectedAddressCoords([directLon, directLat]);
      return;
    }

    const response = await fetch(
      `${baseURL}/geo/geocode?address=${encodeURIComponent(withTyumenBias(address))}`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      },
    );
    const data = await response.json().catch(() => ({}));
    if (response.ok && Number.isFinite(Number(data.lat)) && Number.isFinite(Number(data.lon))) {
      setSelectedAddressCoords([Number(data.lon), Number(data.lat)]);
    }
  };

  const handleSavedAddressSelect = async (address: ClientAddress) => {
    const addressLabel = address.full_address || address.address || "";
    setAddressMode("saved");
    setSelectedSavedAddressId(getClientAddressKey(address));
    setAddressSelected(true);
    setAddressSuggestions([]);
    setSelectedAddressCoords(null);
    setForm((previous) => ({ ...previous, object_address: addressLabel }));
    if (addressLabel) {
      setSelectedAddress(addressLabel);
    }
    try {
      await resolveAddressCoordinates(addressLabel, address);
    } catch {
      setSelectedAddressCoords(null);
    }
  };

  const startManualAddressEntry = () => {
    setAddressMode("new");
    setSelectedSavedAddressId(null);
    setAddressSelected(false);
    setAddressSuggestions([]);
    setSelectedAddressCoords(null);
    setForm((previous) => ({ ...previous, object_address: "" }));
  };

  const handleAddressModeSelect = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextValue = event.target.value;
    if (nextValue === MANUAL_ADDRESS_OPTION) {
      startManualAddressEntry();
      return;
    }

    const nextAddress = clientAddresses.find((item) => getClientAddressKey(item) === nextValue);
    if (nextAddress) {
      await handleSavedAddressSelect(nextAddress);
    }
  };

  const submitApplication = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !token) return;

    setSubmitting(true);
    try {
      const response = await fetch(`${baseURL}/client/equipment-applications`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...form,
          listing_id: selected.id,
          duration_value: Number(form.duration_value),
          total_price: calculatedTotal,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data, "Не удалось отправить заявку"));
      }

      setApplications((previous) => [data, ...previous]);
      toast.success(`Заявка №${String(data.id).slice(0, 8)} принята`);
      setShowApplication(false);
      resetApplicationMeta();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отправить заявку");
    } finally {
      setSubmitting(false);
    }
  };

  if (selected) {
    if (showSupport) {
      return (
        <SupportScreen
          onBack={() => setShowSupport(false)}
          initialContext={{
            type: "equipment_listing",
            id: selected.id,
            subject: `Вопрос по объявлению «${selected.title}»`,
          }}
        />
      );
    }

    const photos = selected.media_files?.length
      ? selected.media_files
      : selected.primary_image_url
        ? [{ id: "primary", public_url: selected.primary_image_url }]
        : [];
    const hasActiveApplication = activeApplicationListingIds.has(selected.id);

    return (
      <div className="px-4 pb-8">
        <button
          onClick={() => setSelected(null)}
          className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-600"
        >
          <ArrowLeft className="h-4 w-4" /> К каталогу
        </button>

        <div className="overflow-hidden rounded-3xl bg-white shadow-sm">
          <div className="flex snap-x gap-2 overflow-x-auto">
            {photos.length ? (
              photos.map((photo) => (
                <img
                  key={photo.id}
                  src={resolveMediaUrl(photo.public_url) || "/placeholder.jpg"}
                  alt={selected.title}
                  className="h-64 w-full shrink-0 snap-start object-cover"
                />
              ))
            ) : (
              <div className="flex h-64 w-full items-center justify-center bg-slate-100">
                <ImageIcon className="h-12 w-12 text-slate-300" />
              </div>
            )}
          </div>

          <div className="p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-sky-600">
              {selected.equipment_type_name}
            </p>
            <h2 className="mt-1 text-2xl font-black text-slate-900">{selected.title}</h2>
            {(selected.city || selected.district) && (
              <p className="mt-2 flex items-center gap-1 text-sm text-slate-500">
                <MapPin className="h-4 w-4" />
                {[selected.city, selected.district].filter(Boolean).join(", ")}
              </p>
            )}
            <p className="mt-4 text-xl font-black text-sky-600">
              {formatEquipmentPrice(selected)}
            </p>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-600">
              {selected.description}
            </p>

            <button
              disabled={hasActiveApplication || !selectedHasConfiguredTariffs}
              onClick={startApplication}
              className="mt-6 w-full rounded-2xl bg-sky-500 px-5 py-4 font-bold text-white shadow-sm active:bg-sky-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
            >
              {hasActiveApplication
                ? "Заявка уже отправлена"
                : !selectedHasConfiguredTariffs
                  ? "Требуется обновление тарифов"
                  : "Оставить заявку"}
            </button>
            <button
              onClick={() => {
                if (!token || role !== "client") {
                  onOpenAuth();
                  return;
                }
                setShowSupport(true);
              }}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-100 px-5 py-3 font-bold text-slate-600"
            >
              <Headphones className="h-4 w-4" /> Задать вопрос оператору
            </button>
          </div>
        </div>

        {showApplication && (
          <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
            <form
              onSubmit={submitApplication}
              className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl"
            >
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-sky-600">ЗАЯВКА НА ТЕХНИКУ</p>
                  <h3 className="text-xl font-black">{selected.title}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowApplication(false);
                    resetApplicationMeta();
                  }}
                  className="rounded-full bg-slate-100 p-2"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-3">
                  <p className="text-sm font-bold">Адрес объекта</p>
                  {clientAddresses.length > 0 && (
                    <div className="space-y-3">
                      <select
                        value={
                          addressMode === "new"
                            ? MANUAL_ADDRESS_OPTION
                            : selectedSavedAddressId || MANUAL_ADDRESS_OPTION
                        }
                        onChange={(event) => void handleAddressModeSelect(event)}
                        disabled={clientAddressesLoading}
                        className="w-full rounded-xl bg-slate-100 p-3 text-sm font-medium outline-none transition focus:ring-2 focus:ring-sky-200 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {clientAddresses.map((address) => {
                          const addressLabel = address.full_address || address.address || "";
                          return (
                            <option key={getClientAddressKey(address)} value={getClientAddressKey(address)}>
                              {addressLabel}
                            </option>
                          );
                        })}
                        <option value={MANUAL_ADDRESS_OPTION}>+ Ввести другой адрес</option>
                      </select>
                      {clientAddressesLoading && (
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                          Загружаем сохраненные адреса...
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {(addressMode === "new" || clientAddresses.length === 0) && (
                  <label className="relative block text-sm font-bold">
                    <input
                      required
                      value={form.object_address}
                      onChange={(event) => {
                        setAddressSelected(false);
                        setSelectedAddressCoords(null);
                        setForm({ ...form, object_address: event.target.value });
                      }}
                      placeholder="Начните вводить адрес"
                      className="w-full rounded-xl bg-slate-100 p-3 font-normal outline-none"
                    />
                    {addressSuggestions.length > 0 && (
                      <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white text-sm font-normal shadow-xl">
                        {addressSuggestions.map((item) => {
                          const address = getSuggestionLabel(item);
                          return (
                            <li key={`${address}-${item.id || item.point?.lon || ""}`}>
                              <button
                                type="button"
                                onClick={async () => {
                                  setForm({ ...form, object_address: address });
                                  setAddressSelected(true);
                                  setAddressSuggestions([]);
                                  setSelectedAddress(address);
                                  try {
                                    await resolveAddressCoordinates(address, item);
                                  } catch {
                                    // Form stays usable even if only address text is available.
                                  }
                                }}
                                className="flex w-full items-start gap-2 border-b border-slate-100 px-3 py-3 text-left last:border-0 hover:bg-slate-50"
                              >
                                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
                                {address}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </label>
                )}

                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                  <div id="equipment-application-map" className="h-52 w-full" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm font-bold">
                    Дата
                    <input
                      required
                      type="date"
                      min={new Date().toISOString().slice(0, 10)}
                      value={form.requested_date}
                      onChange={(event) =>
                        setForm({ ...form, requested_date: event.target.value })
                      }
                      className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal"
                    />
                  </label>
                  <label className="text-sm font-bold">
                    Время
                    <input
                      required
                      type="time"
                      value={form.requested_time}
                      onChange={(event) =>
                        setForm({ ...form, requested_time: event.target.value })
                      }
                      className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm font-bold">
                    Тип аренды
                    <select
                      value={form.duration_unit}
                      onChange={(event) =>
                        setForm({ ...form, duration_unit: event.target.value })
                      }
                      className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal"
                    >
                      {selectedTariffs.map((tariff) => (
                        <option
                          key={tariff.type}
                          value={tariff.type === "hour" ? "hours" : "shifts"}
                        >
                          {tariff.type === "hour" ? "Часы" : "Смены"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-bold">
                    Количество
                    <input
                      required
                      type="number"
                      min="1"
                      step="0.5"
                      value={form.duration_value}
                      onChange={(event) =>
                        setForm({ ...form, duration_value: event.target.value })
                      }
                      className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal"
                    />
                  </label>
                </div>

                <label className="block text-sm font-bold">
                  Телефон
                  <input
                    required
                    value={form.contact_phone}
                    onChange={(event) =>
                      setForm({ ...form, contact_phone: event.target.value })
                    }
                    className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal"
                  />
                </label>

                <label className="block text-sm font-bold">
                  Комментарий
                  <textarea
                    value={form.comment}
                    onChange={(event) => setForm({ ...form, comment: event.target.value })}
                    rows={3}
                    className="mt-1 w-full resize-none rounded-xl bg-slate-100 p-3 font-normal"
                  />
                </label>

                <div className="rounded-2xl bg-sky-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-sky-600">Итого</p>
                  <p className="mt-1 text-2xl font-black text-slate-900">
                    {calculatedTotal == null
                      ? "По договорённости"
                      : `${calculatedTotal.toLocaleString("ru-RU")} ₽`}
                  </p>
                </div>
              </div>

              <button
                disabled={submitting}
                className="mt-5 w-full rounded-2xl bg-sky-500 p-4 font-bold text-white disabled:opacity-50"
              >
                {submitting ? "Отправляем..." : "Отправить заявку"}
              </button>
            </form>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="px-4 pb-8">
      <div className="mb-5">
        <div className="flex items-center gap-2">
          <Wrench className="h-6 w-6 text-sky-500" />
          <h2 className="text-2xl font-black">Спецтехника</h2>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Техника и услуги для вашего объекта
        </p>
      </div>

      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Поиск техники..."
        className="mb-3 w-full rounded-2xl bg-white p-3 shadow-sm outline-none"
      />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <button
          onClick={() => setSelectedType("")}
          className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${
            !selectedType ? "bg-sky-500 text-white" : "bg-white text-slate-600"
          }`}
        >
          Все
        </button>
        {types.map((type) => (
          <button
            key={type.id}
            onClick={() => setSelectedType(type.id)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${
              selectedType === type.id ? "bg-sky-500 text-white" : "bg-white text-slate-600"
            }`}
          >
            {type.name}
          </button>
        ))}
      </div>

      {cities.length > 0 && (
        <div className="relative mb-4">
          <select
            value={city}
            onChange={(event) => setCity(event.target.value)}
            className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-3 pl-4 pr-11 text-sm text-slate-700 shadow-sm outline-none transition focus:border-sky-500"
          >
            <option value="">Все города и районы</option>
            {cities.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </div>
      )}

      {loading ? (
        <p className="py-12 text-center text-slate-400">Загрузка...</p>
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl bg-white p-8 text-center text-slate-500">
          Подходящая техника пока не добавлена
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {filtered.map((item) => (
            <button
              key={item.id}
              onClick={() => setSelected(item)}
              className="overflow-hidden rounded-2xl bg-white text-left shadow-sm"
            >
              {item.primary_image_url ? (
                <img
                  src={resolveMediaUrl(item.primary_image_url) || "/placeholder.jpg"}
                  alt={item.title}
                  className="h-40 w-full object-cover"
                />
              ) : (
                <div className="flex h-40 items-center justify-center bg-slate-100">
                  <ImageIcon className="h-9 w-9 text-slate-300" />
                </div>
              )}
              <div className="p-4">
                <p className="text-xs font-bold text-sky-600">{item.equipment_type_name}</p>
                <h3 className="mt-1 text-lg font-black">{item.title}</h3>
                <p className="mt-2 font-bold text-slate-900">{formatEquipmentPrice(item)}</p>
                {(item.city || item.district) && (
                  <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
                    <MapPin className="h-3 w-3" />
                    {[item.city, item.district].filter(Boolean).join(", ")}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
