import { useEffect, useState } from "react";
import { ArrowLeft, Droplets, ImageIcon, MapPin, Phone } from "lucide-react";
import toast from "react-hot-toast";

import { baseURL, formatPhoneNumber, resolveMediaUrl } from "./utils";

interface SepticProfile {
  id: string;
  phone: string;
  address: string;
  tank_volume_m3: number | string;
  service_price: number | string;
  primary_image_url?: string | null;
  media_files?: { id: string; public_url: string; is_primary?: boolean }[];
}

interface Props {
  onBack: () => void;
}

const phoneLink = (phone: string) => phone.replace(/[^+\d]/g, "");

export default function SepticCatalogScreen({ onBack }: Props) {
  const [profiles, setProfiles] = useState<SepticProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(`${baseURL}/septic-providers`);
        if (!response.ok) throw new Error("Не удалось загрузить услуги откачки септиков");
        const data = await response.json();
        if (!disposed) setProfiles(Array.isArray(data) ? data : []);
      } catch (error) {
        if (!disposed) {
          setProfiles([]);
          toast.error(error instanceof Error ? error.message : "Не удалось загрузить услуги откачки септиков");
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, []);

  return (
    <section className="px-4 pb-8 pt-[max(env(safe-area-inset-top),1rem)]">
      <button type="button" onClick={onBack} className="mb-5 flex items-center gap-2 text-sm font-bold text-slate-600">
        <ArrowLeft className="h-4 w-4" /> К услугам
      </button>

      <header className="mb-5 rounded-3xl bg-sky-500 p-5 text-white shadow-[0_12px_28px_rgba(14,165,233,0.22)]">
        <div className="flex items-center gap-3">
          <span className="rounded-2xl bg-white/20 p-3"><Droplets className="h-7 w-7" /></span>
          <div>
            <h1 className="text-2xl font-black">Откачка септиков</h1>
            <p className="mt-1 text-sm text-sky-50">Выберите подходящего исполнителя и позвоните напрямую</p>
          </div>
        </div>
      </header>

      {loading ? (
        <p className="py-12 text-center text-sm font-medium text-slate-400">Загружаем предложения…</p>
      ) : profiles.length === 0 ? (
        <div className="rounded-3xl bg-white p-8 text-center shadow-sm">
          <Droplets className="mx-auto h-10 w-10 text-sky-200" />
          <h2 className="mt-3 text-lg font-black text-slate-800">Предложений пока нет</h2>
          <p className="mt-1 text-sm text-slate-500">Одобренные профили появятся здесь.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {profiles.map((profile) => {
            const primaryImage = profile.primary_image_url || profile.media_files?.find((media) => media.is_primary)?.public_url;
            const phone = phoneLink(profile.phone);
            return (
              <article key={profile.id} className="overflow-hidden rounded-3xl bg-white shadow-sm">
                {primaryImage ? (
                  <img src={resolveMediaUrl(primaryImage)} alt={`Откачка септика: ${profile.address}`} className="h-44 w-full object-cover" />
                ) : (
                  <div className="flex h-32 items-center justify-center bg-sky-50"><ImageIcon className="h-10 w-10 text-sky-200" /></div>
                )}
                <div className="space-y-4 p-5">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-sky-600">Услуга</p>
                    <h2 className="mt-1 text-xl font-black text-slate-900">Откачка септика</h2>
                  </div>
                  <p className="flex gap-2 text-sm leading-relaxed text-slate-600">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
                    {profile.address}
                  </p>
                  <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-4">
                    <p><span className="block text-xs text-slate-400">Объём цистерны</span><strong className="mt-1 block text-slate-800">{Number(profile.tank_volume_m3).toLocaleString("ru-RU")} м³</strong></p>
                    <p><span className="block text-xs text-slate-400">Стоимость услуги</span><strong className="mt-1 block text-slate-800">{Number(profile.service_price).toLocaleString("ru-RU")} ₽</strong></p>
                  </div>
                  {phone ? (
                    <a href={`tel:${phone}`} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 px-5 py-4 text-base font-black text-white shadow-sm transition hover:bg-sky-600 active:bg-sky-700">
                      <Phone className="h-5 w-5" /> Позвонить
                    </a>
                  ) : (
                    <button type="button" disabled className="w-full rounded-2xl bg-slate-200 px-5 py-4 font-bold text-slate-500">Телефон не указан</button>
                  )}
                  {phone ? <p className="text-center text-xs font-medium text-slate-500">{formatPhoneNumber(profile.phone)}</p> : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
