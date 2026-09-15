import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Plus, Save, SlidersHorizontal } from "lucide-react";
import toast from "react-hot-toast";
import { baseURL, extractApiErrorMessage } from "../../utils";

type Category = { id: string; title: string; capacity_min_m3: number; capacity_max_m3?: number | null };
type City = { id: string; name: string };
type Tariff = {
  id: string; distance_from_km: number; distance_to_km?: number | null;
  rate_per_km: number; min_price_quarry: number; min_price_warehouse: number; is_active: boolean;
};

const emptyDraft = { distance_from_km: "", distance_to_km: "", rate_per_km: "", min_price_quarry: "", min_price_warehouse: "" };

export default function TransportTariffsPanel({ token }: { token: string | null }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [cityId, setCityId] = useState("");
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const loadTariffs = async (currentCategoryId = categoryId, currentCityId = cityId) => {
    if (!currentCategoryId || !currentCityId || !token) return setTariffs([]);
    const response = await fetch(`${baseURL}/admin/transport-categories/${currentCategoryId}/tariffs?city_id=${currentCityId}`, { headers });
    if (response.ok) setTariffs(await response.json());
  };
  useEffect(() => { void (async () => {
    if (!token) return;
    try {
      const [categoryResponse, cityResponse] = await Promise.all([
        fetch(`${baseURL}/admin/transport-categories`, { headers }), fetch(`${baseURL}/cities/`),
      ]);
      const nextCategories = categoryResponse.ok ? await categoryResponse.json() : [];
      const nextCities = cityResponse.ok ? await cityResponse.json() : [];
      setCategories(nextCategories); setCities(nextCities);
      setCategoryId(nextCategories[0]?.id || ""); setCityId(nextCities[0]?.id || "");
    } finally { setLoading(false); }
  })(); }, [token]);
  useEffect(() => { void loadTariffs(); }, [categoryId, cityId]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!categoryId || !cityId) return;
    const payload = {
      city_id: cityId,
      distance_from_km: Number(draft.distance_from_km),
      distance_to_km: draft.distance_to_km === "" ? null : Number(draft.distance_to_km),
      rate_per_km: Number(draft.rate_per_km),
      min_price_quarry: Number(draft.min_price_quarry),
      min_price_warehouse: Number(draft.min_price_warehouse),
    };
    setSaving(true);
    try {
      const response = await fetch(editingId ? `${baseURL}/admin/transport-tariffs/${editingId}` : `${baseURL}/admin/transport-categories/${categoryId}/tariffs`, {
        method: editingId ? "PATCH" : "POST", headers, body: JSON.stringify(editingId ? (({ city_id, ...rest }) => rest)(payload) : payload),
      });
      if (!response.ok) throw new Error(await extractApiErrorMessage({ status: response.status, data: await response.json().catch(() => null) }, "Не удалось сохранить тариф"));
      toast.success("Тариф сохранён"); setDraft(emptyDraft); setEditingId(null); await loadTariffs();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось сохранить тариф"); }
    finally { setSaving(false); }
  };
  if (loading) return <div className="flex justify-center rounded-2xl bg-white p-12 shadow-sm"><Loader2 className="h-7 w-7 animate-spin text-[#2DB0E6]" /></div>;
  return <section className="flex flex-col gap-4">
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-50 text-[#2DB0E6]"><SlidersHorizontal className="h-5 w-5" /></span><div><h2 className="font-bold text-slate-900">Городские тарифы</h2><p className="text-sm text-slate-500">Ставка и минимум применяются к каждому рейсу выбранной категории.</p></div></div>
      <div className="grid gap-3 sm:grid-cols-2"><select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 font-medium text-slate-800">{categories.map((category) => <option key={category.id} value={category.id}>{category.title} · {category.capacity_min_m3}–{category.capacity_max_m3 ?? "∞"} м³</option>)}</select><select value={cityId} onChange={(e) => setCityId(e.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 font-medium text-slate-800">{cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}</select></div>
    </div>
    <form onSubmit={save} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between"><h3 className="font-bold text-slate-800">{editingId ? "Редактирование диапазона" : "Новый диапазон"}</h3>{editingId && <button type="button" onClick={() => { setEditingId(null); setDraft(emptyDraft); }} className="text-sm font-semibold text-slate-500">Отмена</button>}</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{([['distance_from_km','От, км'],['distance_to_km','До, км'],['rate_per_km','₽ / км'],['min_price_quarry','Мин. карьер'],['min_price_warehouse','Мин. склад']] as const).map(([key,label]) => <label key={key} className="text-xs font-semibold text-slate-500">{label}<input required={key !== 'distance_to_km'} min="0" step="0.01" type="number" value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-800 focus:border-[#2DB0E6] focus:outline-none" /></label>)}</div>
      <button disabled={saving} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#2DB0E6] px-4 py-2.5 font-bold text-white shadow-sm disabled:opacity-50"><Save className="h-4 w-4" />{saving ? "Сохраняем" : editingId ? "Сохранить" : "Добавить тариф"}</button>
    </form>
    <div className="grid gap-3">{tariffs.map((tariff) => <button key={tariff.id} onClick={() => { setEditingId(tariff.id); setDraft({ distance_from_km: String(tariff.distance_from_km), distance_to_km: tariff.distance_to_km == null ? "" : String(tariff.distance_to_km), rate_per_km: String(tariff.rate_per_km), min_price_quarry: String(tariff.min_price_quarry), min_price_warehouse: String(tariff.min_price_warehouse) }); }} className="rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm transition-colors hover:border-sky-200 hover:bg-sky-50/30"><div className="flex items-center justify-between"><span className="font-bold text-slate-800">{tariff.distance_from_km}–{tariff.distance_to_km ?? "∞"} км</span><span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700">{tariff.rate_per_km} ₽/км</span></div><p className="mt-1 text-sm text-slate-500">Минимум: карьер {tariff.min_price_quarry} ₽ · склад {tariff.min_price_warehouse} ₽</p></button>)}{tariffs.length === 0 && <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">В этом городе ещё нет тарифных диапазонов.</div>}</div>
  </section>;
}
