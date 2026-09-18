import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Save, SlidersHorizontal, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { baseURL, extractApiErrorMessage } from "../../utils";

type Category = {
  id: string;
  slug: string;
  title: string;
  capacity_min_m3: number;
  capacity_max_m3?: number | null;
  is_active: boolean;
  sort_order: number;
};
type City = { id: string; name: string };
type Tariff = {
  id: string;
  distance_from_km: number;
  distance_to_km?: number | null;
  rate_per_km: number;
  min_price_quarry: number;
  min_price_warehouse: number;
  is_active: boolean;
};

const emptyTariffDraft = {
  distance_from_km: "",
  distance_to_km: "",
  rate_per_km: "",
  min_price_quarry: "",
  min_price_warehouse: "",
};
const emptyCategoryDraft = {
  title: "",
  capacity_min_m3: "",
  capacity_max_m3: "",
};

export default function TransportTariffsPanel({ token }: { token: string | null }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [cityId, setCityId] = useState("");
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [tariffDraft, setTariffDraft] = useState(emptyTariffDraft);
  const [editingTariffId, setEditingTariffId] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState(emptyCategoryDraft);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingTariff, setSavingTariff] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const loadCategories = async () => {
    if (!token) return [];
    const response = await fetch(`${baseURL}/admin/transport-categories`, { headers });
    if (!response.ok) throw new Error("Не удалось загрузить категории транспорта");
    const nextCategories: Category[] = await response.json();
    setCategories(nextCategories);
    setCategoryId((current) =>
      nextCategories.some((category) => category.id === current)
        ? current
        : nextCategories[0]?.id || "",
    );
    return nextCategories;
  };

  const loadTariffs = async (currentCategoryId = categoryId, currentCityId = cityId) => {
    if (!currentCategoryId || !currentCityId || !token) {
      setTariffs([]);
      return [];
    }
    const response = await fetch(
      `${baseURL}/admin/transport-categories/${currentCategoryId}/tariffs?city_id=${currentCityId}`,
      { headers },
    );
    if (!response.ok) {
      throw new Error(await extractApiErrorMessage(
        { status: response.status, data: await response.json().catch(() => null) },
        "Не удалось загрузить тарифы.",
      ));
    }
    const nextTariffs: Tariff[] = await response.json();
    setTariffs(nextTariffs);
    return nextTariffs;
  };

  useEffect(() => {
    void (async () => {
      if (!token) return;
      try {
        const [nextCategories, cityResponse] = await Promise.all([
          loadCategories(),
          fetch(`${baseURL}/cities/`),
        ]);
        const nextCities: City[] = cityResponse.ok ? await cityResponse.json() : [];
        setCities(nextCities);
        setCategoryId(nextCategories[0]?.id || "");
        setCityId(nextCities[0]?.id || "");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Не удалось загрузить настройки транспорта");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  useEffect(() => {
    void loadTariffs().catch((error) => {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить тарифы.");
    });
  }, [categoryId, cityId]);

  const saveCategory = async (event: FormEvent) => {
    event.preventDefault();
    const minimum = Number(categoryDraft.capacity_min_m3);
    const maximum = categoryDraft.capacity_max_m3 === "" ? null : Number(categoryDraft.capacity_max_m3);
    if (!categoryDraft.title.trim() || !Number.isFinite(minimum) || minimum <= 0 || (maximum !== null && (!Number.isFinite(maximum) || maximum < minimum))) {
      toast.error("Укажите название и корректный диапазон кубатуры");
      return;
    }
    setSavingCategory(true);
    try {
      const editingCategory = categories.find((category) => category.id === editingCategoryId);
      const payload = {
        title: categoryDraft.title.trim(),
        capacity_min_m3: minimum,
        capacity_max_m3: maximum,
        ...(editingCategoryId
          ? {}
          : {
              slug: `category-${Date.now()}`,
              is_active: true,
              sort_order: categories.length * 10 + 10,
            }),
      };
      const response = await fetch(
        editingCategoryId
          ? `${baseURL}/admin/transport-categories/${editingCategoryId}`
          : `${baseURL}/admin/transport-categories`,
        {
          method: editingCategoryId ? "PATCH" : "POST",
          headers,
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        throw new Error(await extractApiErrorMessage(
          { status: response.status, data: await response.json().catch(() => null) },
          "Не удалось сохранить категорию",
        ));
      }
      const savedCategory: Category = await response.json();
      await loadCategories();
      setCategoryId(savedCategory.id);
      setCategoryDraft(emptyCategoryDraft);
      setEditingCategoryId(null);
      toast.success(editingCategory ? "Категория обновлена" : "Категория добавлена");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить категорию");
    } finally {
      setSavingCategory(false);
    }
  };

  const deleteCategory = async (category: Category) => {
    if (!window.confirm(`Удалить категорию «${category.title}»?`)) return;
    try {
      const response = await fetch(`${baseURL}/admin/transport-categories/${category.id}`, {
        method: "DELETE",
        headers,
      });
      if (!response.ok) {
        throw new Error(await extractApiErrorMessage(
          { status: response.status, data: await response.json().catch(() => null) },
          "Не удалось удалить категорию",
        ));
      }
      if (editingCategoryId === category.id) {
        setEditingCategoryId(null);
        setCategoryDraft(emptyCategoryDraft);
      }
      await loadCategories();
      toast.success("Категория удалена");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить категорию");
    }
  };

  const saveTariff = async (event: FormEvent) => {
    event.preventDefault();
    if (!categoryId || !cityId) return;
    const payload = {
      city_id: cityId,
      distance_from_km: Number(tariffDraft.distance_from_km),
      distance_to_km: tariffDraft.distance_to_km === "" ? null : Number(tariffDraft.distance_to_km),
      rate_per_km: Number(tariffDraft.rate_per_km),
      min_price_quarry: Number(tariffDraft.min_price_quarry),
      min_price_warehouse: Number(tariffDraft.min_price_warehouse),
    };
    setSavingTariff(true);
    try {
      const response = await fetch(
        editingTariffId
          ? `${baseURL}/admin/transport-tariffs/${editingTariffId}`
          : `${baseURL}/admin/transport-categories/${categoryId}/tariffs`,
        {
          method: editingTariffId ? "PATCH" : "POST",
          headers,
          body: JSON.stringify(editingTariffId ? (({ city_id, ...rest }) => rest)(payload) : payload),
        },
      );
      if (!response.ok) {
        toast.error(await extractApiErrorMessage(
          { status: response.status, data: await response.json().catch(() => null) },
          "Не удалось сохранить тариф.",
        ));
        return;
      }
      await response.json();
      await loadTariffs(categoryId, cityId);
      setTariffDraft(emptyTariffDraft);
      setEditingTariffId(null);
      toast.success(editingTariffId ? "Тариф обновлён" : "Тариф сохранён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить тариф");
    } finally {
      setSavingTariff(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center rounded-2xl bg-white p-12 shadow-sm"><Loader2 className="h-7 w-7 animate-spin text-[#2DB0E6]" /></div>;
  }

  return <section className="flex flex-col gap-4">
    <form onSubmit={saveCategory} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div><h2 className="font-bold text-slate-900">Категории транспорта</h2><p className="text-sm text-slate-500">Диапазон задаёт тип машины, а тарифы настраиваются ниже.</p></div>
        {editingCategoryId && <button type="button" onClick={() => { setEditingCategoryId(null); setCategoryDraft(emptyCategoryDraft); }} className="text-sm font-semibold text-slate-500">Отмена</button>}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-semibold text-slate-500">Название<input required value={categoryDraft.title} onChange={(event) => setCategoryDraft({ ...categoryDraft, title: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-800" /></label>
        <label className="text-xs font-semibold text-slate-500">От, м³<input required min="0.1" step="0.1" type="number" value={categoryDraft.capacity_min_m3} onChange={(event) => setCategoryDraft({ ...categoryDraft, capacity_min_m3: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-800" /></label>
        <label className="text-xs font-semibold text-slate-500">До, м³<input min="0.1" step="0.1" type="number" value={categoryDraft.capacity_max_m3} onChange={(event) => setCategoryDraft({ ...categoryDraft, capacity_max_m3: event.target.value })} placeholder="Без ограничения" className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-800" /></label>
      </div>
      <button disabled={savingCategory} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#2DB0E6] px-4 py-2.5 font-bold text-white shadow-sm disabled:opacity-50"><Save className="h-4 w-4" />{savingCategory ? "Сохраняем" : editingCategoryId ? "Сохранить категорию" : "Добавить категорию"}</button>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {categories.map((category) => <div key={category.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"><button type="button" onClick={() => { setEditingCategoryId(category.id); setCategoryDraft({ title: category.title, capacity_min_m3: String(category.capacity_min_m3), capacity_max_m3: category.capacity_max_m3 == null ? "" : String(category.capacity_max_m3) }); }} className="text-left"><span className="block text-sm font-semibold text-slate-800">{category.title}</span><span className="text-xs text-slate-500">{category.capacity_min_m3}–{category.capacity_max_m3 ?? "∞"} м³</span></button><button type="button" onClick={() => void deleteCategory(category)} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Удалить категорию ${category.title}`}><Trash2 className="h-4 w-4" /></button></div>)}
      </div>
    </form>

    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-50 text-[#2DB0E6]"><SlidersHorizontal className="h-5 w-5" /></span><div><h2 className="font-bold text-slate-900">Городские тарифы</h2><p className="text-sm text-slate-500">Ставка и минимум применяются к каждому рейсу выбранной категории.</p></div></div>
      <div className="grid gap-3 sm:grid-cols-2"><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 font-medium text-slate-800">{categories.map((category) => <option key={category.id} value={category.id}>{category.title} · {category.capacity_min_m3}–{category.capacity_max_m3 ?? "∞"} м³</option>)}</select><select value={cityId} onChange={(event) => setCityId(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 font-medium text-slate-800">{cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}</select></div>
    </div>
    <form onSubmit={saveTariff} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between"><h3 className="font-bold text-slate-800">{editingTariffId ? "Редактирование диапазона" : "Новый диапазон"}</h3>{editingTariffId && <button type="button" onClick={() => { setEditingTariffId(null); setTariffDraft(emptyTariffDraft); }} className="text-sm font-semibold text-slate-500">Отмена</button>}</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{([['distance_from_km','От, км'],['distance_to_km','До, км'],['rate_per_km','₽ / км'],['min_price_quarry','Мин. карьер'],['min_price_warehouse','Мин. склад']] as const).map(([key,label]) => <label key={key} className="text-xs font-semibold text-slate-500">{label}<input required={key !== 'distance_to_km'} min="0" step="0.01" type="number" value={tariffDraft[key]} onChange={(event) => setTariffDraft({ ...tariffDraft, [key]: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-800" /></label>)}</div>
      <button disabled={savingTariff || !categoryId || !cityId} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#2DB0E6] px-4 py-2.5 font-bold text-white shadow-sm disabled:opacity-50"><Save className="h-4 w-4" />{savingTariff ? "Сохраняем" : editingTariffId ? "Сохранить" : "Добавить тариф"}</button>
    </form>
    <div className="grid gap-3">{tariffs.map((tariff) => <button key={tariff.id} onClick={() => { setEditingTariffId(tariff.id); setTariffDraft({ distance_from_km: String(tariff.distance_from_km), distance_to_km: tariff.distance_to_km == null ? "" : String(tariff.distance_to_km), rate_per_km: String(tariff.rate_per_km), min_price_quarry: String(tariff.min_price_quarry), min_price_warehouse: String(tariff.min_price_warehouse) }); }} className="rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm transition-colors hover:border-sky-200 hover:bg-sky-50/30"><div className="flex items-center justify-between"><span className="font-bold text-slate-800">{tariff.distance_from_km}–{tariff.distance_to_km ?? "∞"} км</span><span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700">{tariff.rate_per_km} ₽/км</span></div><p className="mt-1 text-sm text-slate-500">Минимум: карьер {tariff.min_price_quarry} ₽ · склад {tariff.min_price_warehouse} ₽</p></button>)}{tariffs.length === 0 && <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">В этом городе ещё нет тарифных диапазонов.</div>}</div>
  </section>;
}
