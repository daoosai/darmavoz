import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Droplets, ImageIcon, List, Map, MapPin, Phone, X } from "lucide-react";

import MapWebGLFallback, {
  load2GisMapSdk,
  tryCreate2GisMap,
} from "./components/MapWebGLFallback";
import SwipeableBottomSheet from "./SwipeableBottomSheet";
import { baseURL, formatPhoneNumber, resolveMediaUrl } from "./utils";

interface SepticProfile {
  id: string;
  phone: string;
  address: string;
  lat: number;
  lon: number;
  tank_volume_m3: number | string;
  service_price: number | string;
  primary_image_url?: string | null;
  media_files?: { id: string; public_url: string; is_primary?: boolean }[];
}

interface Props {
  onBack: () => void;
}

const DEFAULT_CENTER: [number, number] = [65.534328, 57.152286];

const phoneLink = (phone: string) => phone.replace(/[^+\d]/g, "");

export default function SepticCatalogScreen({ onBack }: Props) {
  const [profiles, setProfiles] = useState<SepticProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showList, setShowList] = useState(false);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRefs = useRef<any[]>([]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedId) ?? null,
    [profiles, selectedId],
  );

  useEffect(() => {
    let disposed = false;
    setLoading(true);

    void fetch(`${baseURL}/septic-providers`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить услуги откачки септиков");
        return response.json() as Promise<SepticProfile[]>;
      })
      .then((data) => {
        if (!disposed) setProfiles(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!disposed) setProfiles([]);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const key = import.meta.env.VITE_2GIS_KEY;
    if (!mapContainerRef.current || !key || mapRef.current) {
      if (!key) setMapUnavailable(true);
      return;
    }

    void load2GisMapSdk()
      .then((mapgl) => {
        if (disposed || !mapContainerRef.current || mapRef.current) return;
        const map = tryCreate2GisMap(
          () => new mapgl.Map(mapContainerRef.current, { center: DEFAULT_CENTER, zoom: 10, key }),
          () => setMapUnavailable(true),
        );
        if (!map || disposed) {
          map?.destroy?.();
          return;
        }
        mapRef.current = map;
        setMapReady(true);
      })
      .catch(() => !disposed && setMapUnavailable(true));

    return () => {
      disposed = true;
      markerRefs.current.forEach((marker) => marker.destroy?.());
      markerRefs.current = [];
      mapRef.current?.destroy?.();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const mapgl = (window as any).mapgl;
    if (!mapReady || !mapRef.current || !mapgl?.HtmlMarker) return;

    markerRefs.current.forEach((marker) => marker.destroy?.());
    markerRefs.current = profiles
      .filter((profile) => Number.isFinite(profile.lat) && Number.isFinite(profile.lon))
      .map((profile) => {
        const element = document.createElement("button");
        element.type = "button";
        element.className = "water-map-marker";
        element.setAttribute("aria-label", `Септик: ${formatPhoneNumber(profile.phone) || profile.address}`);

        const label = document.createElement("span");
        label.className = "water-map-marker__label";
        label.textContent = formatPhoneNumber(profile.phone) || "Септик";
        element.appendChild(label);

        const labelTail = document.createElement("span");
        labelTail.className = "water-map-marker__label-tail";
        element.appendChild(labelTail);

        const pin = document.createElement("span");
        pin.className = "water-map-marker__pin water-map-marker__pin--septic";
        pin.textContent = "🚛";
        element.appendChild(pin);
        element.addEventListener("click", () => setSelectedId(profile.id));

        return new mapgl.HtmlMarker(mapRef.current, {
          coordinates: [profile.lon, profile.lat],
          html: element,
        });
      });

    const first = profiles.find((profile) => Number.isFinite(profile.lat) && Number.isFinite(profile.lon));
    if (first) {
      mapRef.current.setCenter?.([first.lon, first.lat]);
      mapRef.current.setZoom?.(11);
    }
  }, [mapReady, profiles]);

  const renderProfileSummary = (profile: SepticProfile) => {
    const primaryImage = profile.primary_image_url || profile.media_files?.find((media) => media.is_primary)?.public_url;
    return (
      <button
        key={profile.id}
        type="button"
        onClick={() => setSelectedId(profile.id)}
        className="w-full overflow-hidden rounded-2xl bg-white text-left shadow-sm transition hover:shadow-md"
      >
        <div className="flex gap-3 p-3">
          {primaryImage ? (
            <img src={resolveMediaUrl(primaryImage)} alt="" className="h-20 w-24 shrink-0 rounded-xl object-cover" />
          ) : (
            <div className="grid h-20 w-24 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-300"><ImageIcon className="h-7 w-7" /></div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="font-black text-slate-900">Септик</h2>
            <p className="mt-1 flex gap-1 text-sm text-slate-600"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" /> <span className="line-clamp-2">{profile.address}</span></p>
            <p className="mt-1 text-sm font-bold text-sky-600">{Number(profile.service_price).toLocaleString("ru-RU")} ₽</p>
          </div>
        </div>
      </button>
    );
  };

  const primaryImage = selectedProfile?.primary_image_url || selectedProfile?.media_files?.find((media) => media.is_primary)?.public_url;
  const selectedPhone = selectedProfile ? phoneLink(selectedProfile.phone) : "";

  return (
    <section className="relative flex h-full min-h-[480px] flex-1 overflow-hidden rounded-t-[28px] bg-slate-100 sm:rounded-[28px]">
      <div className="absolute inset-0 bg-slate-100">
        <div ref={mapContainerRef} className="h-full w-full" aria-label="Карта машин для откачки септиков" />
        {mapUnavailable ? <MapWebGLFallback className="absolute inset-0" /> : null}
      </div>

      {showList ? (
        <div className="absolute inset-0 z-[5] overflow-y-auto bg-slate-100 px-4 pb-6 pt-28">
          <div className="space-y-3">{profiles.map(renderProfileSummary)}</div>
        </div>
      ) : null}

      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 px-4 pt-[max(env(safe-area-inset-top),1rem)]">
        <div className="pointer-events-auto rounded-3xl bg-white/95 p-3 shadow-xl backdrop-blur">
          <div className="flex items-center gap-3">
            <button type="button" onClick={onBack} className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-600" aria-label="Вернуться на главный экран">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <span className="rounded-2xl bg-sky-100 p-2.5 text-sky-600"><Droplets className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-black text-slate-900">Карта септиков</h1>
              <p className="text-sm text-slate-500">Выберите машину на карте</p>
            </div>
            <button
              type="button"
              onClick={() => { setShowList((current) => !current); setSelectedId(null); }}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-sky-500 px-3 py-2 text-sm font-bold text-white"
            >
              {showList ? <Map className="h-4 w-4" /> : <List className="h-4 w-4" />}
              {showList ? "На карте" : "Списком"}
            </button>
          </div>
        </div>
      </header>

      {loading ? <div className="pointer-events-none absolute inset-x-4 top-32 z-10 rounded-2xl bg-white p-4 text-sm font-medium text-slate-600 shadow-xl">Загружаем машины…</div> : null}
      {!loading && profiles.length === 0 ? <div className="pointer-events-none absolute inset-x-4 top-32 z-10 rounded-2xl bg-white p-4 text-sm font-medium text-slate-600 shadow-xl">Одобренных предложений пока нет.</div> : null}

      <SwipeableBottomSheet
        isOpen={Boolean(selectedProfile)}
        onClose={() => setSelectedId(null)}
        containerClassName="pointer-events-none absolute inset-0 z-20 flex items-end justify-center"
        sheetClassName="pointer-events-auto w-full max-w-md overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:mb-4 sm:rounded-2xl"
        showOverlay={false}
      >
        {selectedProfile ? (
          <div className="hide-scrollbar max-h-[72dvh] overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex items-start justify-between gap-3 pb-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-sky-600">Услуга</p>
                <h2 className="mt-1 text-xl font-black text-slate-900">Откачка септика</h2>
              </div>
              <button type="button" onClick={() => setSelectedId(null)} className="shrink-0 rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200" aria-label="Закрыть детали септика">
                <X className="h-5 w-5" />
              </button>
            </div>

            {primaryImage ? (
              <div className="overflow-hidden rounded-2xl bg-slate-100"><img src={resolveMediaUrl(primaryImage)} alt={`Откачка септика: ${selectedProfile.address}`} className="aspect-[16/9] w-full object-cover" /></div>
            ) : null}

            <div className="mt-4 space-y-3">
              <p className="flex gap-2 text-sm leading-relaxed text-slate-600"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />{selectedProfile.address}</p>
              {selectedProfile.phone ? <p className="flex items-center gap-2 text-sm font-bold text-slate-700"><Phone className="h-4 w-4 text-sky-600" />{formatPhoneNumber(selectedProfile.phone)}</p> : null}
              <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-4 text-sm">
                <p><span className="block text-xs text-slate-400">Объём цистерны</span><strong className="mt-1 block text-slate-800">{Number(selectedProfile.tank_volume_m3).toLocaleString("ru-RU")} м³</strong></p>
                <p><span className="block text-xs text-slate-400">Стоимость услуги</span><strong className="mt-1 block text-slate-800">{Number(selectedProfile.service_price).toLocaleString("ru-RU")} ₽</strong></p>
              </div>
              {selectedPhone ? (
                <a href={`tel:${selectedPhone}`} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 px-5 py-4 text-base font-black text-white shadow-sm transition hover:bg-sky-600 active:bg-sky-700">
                  <Phone className="h-5 w-5" /> Позвонить
                </a>
              ) : (
                <button type="button" disabled className="w-full rounded-2xl bg-slate-200 px-5 py-4 font-bold text-slate-500">Телефон не указан</button>
              )}
            </div>
          </div>
        ) : null}
      </SwipeableBottomSheet>
    </section>
  );
}
