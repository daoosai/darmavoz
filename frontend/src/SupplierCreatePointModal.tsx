import { useEffect, useState, type FormEvent } from "react";
import { Loader2, MapPin, Plus, X } from "lucide-react";
import toast from "react-hot-toast";

import { baseURL, extractApiErrorMessage } from "./utils";

interface Material {
  id: string;
  name: string;
  unit: string;
}

interface Props {
  token: string;
  onClose: () => void;
  onCreated: (point: any) => void;
}

const initialForm = {
  point_type: "quarry",
  name: "",
  short_name: "",
  address: "",
  description: "",
  lat: "57.152223",
  lon: "65.527202",
};

export default function SupplierCreatePointModal({ token, onClose, onCreated }: Props) {
  const [form, setForm] = useState(initialForm);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [offerPrices, setOfferPrices] = useState<Record<string, string>>({});
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    fetch(`${baseURL}/catalog/materials/`)
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => setMaterials(Array.isArray(data) ? data : []))
      .catch(() => toast.error("Не удалось загрузить материалы"));
  }, []);

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

    setIsBusy(true);
    try {
      const response = await fetch(`${baseURL}/supplier/points`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...form,
          short_name: form.short_name || null,
          description: form.description || null,
          lat: Number(form.lat),
          lon: Number(form.lon),
          material_offers: materialOffers,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data, "Не удалось создать точку"));
      }
      onCreated(data);
      toast.success("Точка добавлена в черновики");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать точку");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#102c25]/70 backdrop-blur-sm">
      <div className="min-h-screen bg-[#f5f1e8] sm:mx-auto sm:my-6 sm:min-h-0 sm:max-w-xl sm:rounded-[2rem]">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-[#f5f1e8]/95 px-5 py-4 backdrop-blur">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#b46b3f]">Новая карточка</p>
            <h2 className="text-2xl font-black text-[#183c33]">Точка забора</h2>
          </div>
          <button onClick={onClose} className="rounded-full bg-white p-3 shadow-sm" aria-label="Закрыть">
            <X className="h-5 w-5" />
          </button>
        </header>

        <form onSubmit={submit} className="space-y-6 p-5 pb-12">
          <section className="grid grid-cols-3 gap-2 rounded-2xl bg-white p-2">
            {[
              ["quarry", "Карьер"],
              ["accumulator", "Накопитель"],
              ["warehouse", "База / склад"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setForm({ ...form, point_type: value })}
                className={`rounded-xl px-2 py-3 text-sm font-bold ${form.point_type === value ? "bg-[#183c33] text-white" : "text-stone-500"}`}
              >
                {label}
              </button>
            ))}
          </section>

          <section className="space-y-3 rounded-[1.5rem] bg-white p-5">
            <input required placeholder="Название точки" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-xl border border-stone-200 p-3" />
            <input placeholder="Короткое название для карты" value={form.short_name} onChange={(e) => setForm({ ...form, short_name: e.target.value })} className="w-full rounded-xl border border-stone-200 p-3" />
            <input required placeholder="Адрес" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full rounded-xl border border-stone-200 p-3" />
            <textarea placeholder="Описание" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="min-h-24 w-full rounded-xl border border-stone-200 p-3" />
          </section>

          <section className="rounded-[1.5rem] bg-white p-5">
            <div className="mb-3 flex items-center gap-2 font-bold"><MapPin className="h-5 w-5 text-[#b46b3f]" />Координаты</div>
            <div className="grid grid-cols-2 gap-3">
              <input required type="number" step="any" aria-label="Широта" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} className="rounded-xl border border-stone-200 p-3" />
              <input required type="number" step="any" aria-label="Долгота" value={form.lon} onChange={(e) => setForm({ ...form, lon: e.target.value })} className="rounded-xl border border-stone-200 p-3" />
            </div>
          </section>

          <section className="rounded-[1.5rem] bg-white p-5">
            <h3 className="font-bold">Материалы и цены</h3>
            <p className="mt-1 text-sm text-stone-500">Можно выбрать несколько позиций.</p>
            <div className="mt-4 space-y-3">
              {materials.map((material) => {
                const selected = material.id in offerPrices;
                return (
                  <div key={material.id} className="flex items-center gap-3 rounded-xl border border-stone-200 p-3">
                    <button type="button" onClick={() => toggleMaterial(material.id)} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${selected ? "bg-[#183c33] text-white" : "bg-stone-100 text-stone-400"}`}>
                      {selected ? <Plus className="h-4 w-4 rotate-45" /> : <Plus className="h-4 w-4" />}
                    </button>
                    <span className="min-w-0 flex-1 font-semibold">{material.name}</span>
                    {selected && (
                      <label className="flex items-center gap-1 text-sm text-stone-500">
                        <input required type="number" min="0.01" step="0.01" value={offerPrices[material.id]} onChange={(e) => setOfferPrices({ ...offerPrices, [material.id]: e.target.value })} className="w-24 rounded-lg border border-stone-200 p-2 text-right text-stone-900" />
                        ₽/{material.unit}
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <button disabled={isBusy} className="flex w-full items-center justify-center rounded-2xl bg-[#b46b3f] py-4 text-lg font-black text-white disabled:opacity-50">
            {isBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Сохранить точку"}
          </button>
        </form>
      </div>
    </div>
  );
}
