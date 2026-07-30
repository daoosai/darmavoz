import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Headphones, ImageIcon, MapPin, Phone, Wrench } from "lucide-react";
import toast from "react-hot-toast";

import SupportScreen from "./SupportScreen";
import { useAuthStore } from "./store";
import {
  baseURL,
  formatPhoneNumber,
  resolveMediaUrl,
} from "./utils";

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
  contact_phone?: string | null;
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
  is_vip?: boolean;
  manual_priority?: number;
  price_from?: number | null;
  moderation_status?:
    | "incomplete"
    | "pending_moderation"
    | "has_pending_changes"
    | "approved"
    | "rejected"
    | "suspended";
  moderation_comment?: string | null;
  pending_changes?: Record<string, unknown> | null;
}

interface Props {
  onOpenAuth: () => void;
}

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

const getListingPhone = (item: EquipmentListing) => item.contact_phone || item.owner_phone || "";

export default function EquipmentCatalogScreen({ onOpenAuth }: Props) {
  const { token, role } = useAuthStore();
  const [types, setTypes] = useState<EquipmentTypeItem[]>([]);
  const [listings, setListings] = useState<EquipmentListing[]>([]);
  const [selectedType, setSelectedType] = useState("");
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("");
  const [selected, setSelected] = useState<EquipmentListing | null>(null);
  const [showSupport, setShowSupport] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
        const loadedListings: EquipmentListing[] = await listingsResponse.json();
        setTypes(loadedTypes.filter((item) => item.is_active));
        setListings(Array.isArray(loadedListings) ? loadedListings : []);
      } catch {
        toast.error("Не удалось загрузить каталог спецтехники");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

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
    const contactPhone = getListingPhone(selected);

    return (
      <div className="px-4 pb-8">
        <button
          onClick={() => setSelected(null)}
          className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-600"
        >
          <ArrowLeft className="h-4 w-4" /> К каталогу
        </button>

        <div className="overflow-hidden rounded-3xl bg-white shadow-sm">
          <div className="relative flex snap-x gap-2 overflow-x-auto">
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
            {selected.is_vip ? (
              <div className="pointer-events-none absolute left-4 top-4 z-10 inline-flex items-center rounded-full bg-amber-400 px-3 py-1 text-xs font-bold text-white shadow-lg">
                Рекомендуем
              </div>
            ) : null}
          </div>

          <div className="p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-sky-600">
              {selected.equipment_type_name}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-black text-slate-900">{selected.title}</h2>
              {selected.is_vip ? (
                <span className="inline-flex items-center rounded-full bg-amber-400 px-3 py-1 text-xs font-bold text-white">
                  Рекомендуем
                </span>
              ) : null}
            </div>
            {(selected.city || selected.district) && (
              <p className="mt-2 flex items-center gap-1 text-sm text-slate-500">
                <MapPin className="h-4 w-4" />
                {[selected.city, selected.district].filter(Boolean).join(", ")}
              </p>
            )}
            <p className="mt-4 text-xl font-black text-sky-600">{formatEquipmentPrice(selected)}</p>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-600">
              {selected.description}
            </p>

            <div className="mt-6 rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                Контактный телефон
              </p>
              <p className="mt-2 text-lg font-black text-slate-900">
                {contactPhone ? formatPhoneNumber(contactPhone) : "Не указан"}
              </p>
            </div>

            {contactPhone ? (
              <a
                href={`tel:${contactPhone}`}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 px-5 py-4 font-bold text-white shadow-sm active:bg-sky-600"
              >
                <Phone className="h-5 w-5" /> Позвонить
              </a>
            ) : (
              <button
                type="button"
                disabled
                className="mt-4 w-full rounded-2xl bg-slate-300 px-5 py-4 font-bold text-slate-600"
              >
                Телефон не указан
              </button>
            )}

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
          Доска объявлений спецтехники с прямым звонком поставщику
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
          className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${!selectedType ? "bg-sky-500 text-white" : "bg-white text-slate-600"}`}
        >
          Все
        </button>
        {types.map((type) => (
          <button
            key={type.id}
            onClick={() => setSelectedType(type.id)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${selectedType === type.id ? "bg-sky-500 text-white" : "bg-white text-slate-600"}`}
          >
            {type.name}
          </button>
        ))}
      </div>

      {cities.length > 0 && (
        <select
          value={city}
          onChange={(event) => setCity(event.target.value)}
          className="mb-4 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 shadow-sm outline-none"
        >
          <option value="">Все города и районы</option>
          {cities.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
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
              className="overflow-hidden rounded-2xl bg-white text-left shadow-sm transition"
            >
              <div className="relative">
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
                {item.is_vip ? (
                  <span className="pointer-events-none absolute left-3 top-3 inline-flex items-center rounded-full bg-amber-400 px-3 py-1 text-xs font-bold text-white shadow-lg">
                    Рекомендуем
                  </span>
                ) : null}
              </div>
              <div className="p-4">
                <p className="text-xs font-bold text-sky-600">{item.equipment_type_name}</p>
                <div className="mt-1 flex items-start justify-between gap-2">
                  <h3 className="text-lg font-black">{item.title}</h3>
                </div>
                <p className="mt-2 font-bold text-slate-900">{formatEquipmentPrice(item)}</p>
                {(item.city || item.district) && (
                  <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
                    <MapPin className="h-3 w-3" />
                    {[item.city, item.district].filter(Boolean).join(", ")}
                  </p>
                )}
                <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-500">
                  <Phone className="h-3.5 w-3.5" />
                  {getListingPhone(item) ? formatPhoneNumber(getListingPhone(item)) : "Телефон в карточке"}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
