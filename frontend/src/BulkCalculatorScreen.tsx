import { useEffect, useState } from 'react';
import { Calculator, PencilLine } from 'lucide-react';
import { baseURL } from './utils';
import { calculateBulk, describeLoads, formatBulk } from './bulkCalculator';
import { useCalculatorStore } from './calculatorStore';

type MaterialReference = { id: string; name: string; bulk_density_t_m3: number | null };
type References = {
  materials: MaterialReference[];
  delivery_options: { id: string; title: string; capacity_m3: number }[];
};

const densityDefaults: Array<[string, number]> = [
  ['песок', 1.5],
  ['щеб', 1.4],
  ['торф', 0.8],
  ['грав', 1.5],
  ['грунт', 1.3],
  ['земл', 1.3],
  ['черноз', 1.2],
  ['керамзит', 0.4],
  ['асфальт', 2.3],
];

function getMaterialDensity(material?: MaterialReference): string {
  if (!material) return '';
  const defaultDensity = densityDefaults.find(([name]) => material.name.toLowerCase().includes(name));
  return String(defaultDensity?.[1] ?? material.bulk_density_t_m3 ?? '');
}

export default function BulkCalculatorScreen({ materialId, onClose, onGoToCatalog, onChooseSupplier }: {
  materialId?: string; onClose: () => void; onGoToCatalog: () => void; onChooseSupplier: (id: string) => void;
}) {
  const { draft, update, setContext } = useCalculatorStore();
  const [references, setReferences] = useState<References | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [isDensityEditable, setIsDensityEditable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    fetch(`${baseURL}/catalog/calculator/`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('Не удалось загрузить справочники');
        const data: References = await res.json();
        if (controller.signal.aborted) return;
        setReferences(data);
        if (materialId) {
          const material = data.materials.find((item) => item.id === materialId);
          if (material) update({ materialId, density: getMaterialDensity(material), includeMass: true });
        }
        else if (!draft.capacity) update({ capacity: '20' });
      }).catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [attempt, draft.capacity, materialId, update]);

  let result: ReturnType<typeof calculateBulk> | null = null;
  let validation = '';
  try {
    result = calculateBulk({ ...draft, density: draft.density });
  } catch (err) { validation = (err as Error).message; }
  const material = references?.materials.find((item) => item.id === draft.materialId);
  const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-200 bg-white p-3 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100';
  const selectMaterial = (id: string) => {
    const selectedMaterial = references?.materials.find((item) => item.id === id);
    setIsDensityEditable(false);
    update({ materialId: id, density: getMaterialDensity(selectedMaterial), includeMass: true });
  };
  return <section role="dialog" aria-modal="true" aria-label="Калькулятор материалов" className="fixed inset-0 z-[100] overflow-y-auto bg-slate-50 pt-[max(env(safe-area-inset-top),2.5rem)] pb-[max(env(safe-area-inset-bottom),1rem)]">
    <div className="mx-auto max-w-md space-y-5 px-4">
      <button type="button" onClick={onClose} className="py-2 font-semibold text-sky-600">← Назад</button>
      <header className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
        <span className="mb-3 inline-flex rounded-2xl bg-blue-50 p-3 text-sky-600"><Calculator className="h-6 w-6" /></span>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Калькулятор материалов</h1>
        <p className="mt-2 text-sm leading-5 text-slate-500">Введите размеры участка — объём, вес и количество машин рассчитаются автоматически.</p>
      </header>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error} <button className="font-bold text-sky-600" onClick={() => setAttempt((value) => value + 1)}>Повторить</button></p>}
      {!references && !error && <p className="text-sm text-slate-500">Загрузка справочников…</p>}

      <section className="space-y-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
        <label className="block text-sm font-bold text-slate-700">Материал
          <select aria-label="Материал" className={inputClass} value={draft.materialId} onChange={(event) => selectMaterial(event.target.value)}>
            <option value="">Выберите материал</option>{references?.materials.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        {references?.materials.length === 0 && <p className="text-sm text-slate-500">Материалы для расчёта пока не настроены.</p>}
        <div className="grid grid-cols-2 gap-3">
          {([['length', 'Длина, м'], ['width', 'Ширина, м']] as const).map(([field, label]) => <label key={field} className="block text-sm font-bold text-slate-700">{label}<input aria-label={label} className={inputClass} inputMode="decimal" value={draft[field]} onChange={(event) => update({ [field]: event.target.value })} /></label>)}
        </div>
        <label className="block text-sm font-bold text-slate-700">Толщина слоя
          <div className="mt-1.5 flex gap-2">
            <input aria-label="Толщина слоя" className={inputClass.replace('mt-1.5 ', '')} inputMode="decimal" value={draft.thickness} onChange={(event) => update({ thickness: event.target.value })} />
            <select aria-label="Единица толщины" className="w-28 rounded-xl border border-slate-200 bg-white px-2 text-sm font-semibold outline-none focus:border-sky-400" value={draft.thicknessUnit} onChange={(event) => update({ thicknessUnit: event.target.value as 'cm' | 'm' })}><option value="cm">см</option><option value="m">м</option></select>
          </div>
        </label>
        <div className="flex flex-wrap gap-2" aria-label="Быстрый выбор толщины">
          {[5, 10, 15, 20].map((value) => <button key={value} type="button" onClick={() => update({ thickness: String(value), thicknessUnit: 'cm' })} className={`rounded-full px-3 py-1.5 text-sm font-bold transition ${draft.thickness === String(value) && draft.thicknessUnit === 'cm' ? 'bg-sky-500 text-white' : 'bg-slate-100 text-slate-600 active:bg-slate-200'}`}>{value} см</button>)}
        </div>
        <label className="block text-sm font-bold text-slate-700">Кубатура машины, м³<input aria-label="Кубатура машины, м³" className={inputClass} inputMode="decimal" value={draft.capacity} onChange={(event) => update({ capacity: event.target.value })} /></label>
        <select aria-label="Кубатура из справочника" className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 outline-none focus:border-sky-400" value="" onChange={(event) => { if (event.target.value) update({ capacity: event.target.value }); }}><option value="">Выбрать кубатуру из справочника</option>{references?.delivery_options.map((item) => <option key={item.id} value={item.capacity_m3}>{item.title} — {item.capacity_m3} м³</option>)}</select>
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <label className="text-sm font-bold text-slate-700" htmlFor="calculator-density">Плотность, т/м³</label>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-sky-700"><input type="checkbox" checked={isDensityEditable} onChange={(event) => setIsDensityEditable(event.target.checked)} /><PencilLine className="h-3.5 w-3.5" /> Изменить вручную</label>
          </div>
          <input id="calculator-density" aria-label="Плотность, т/м³" className={`${inputClass} ${isDensityEditable ? '' : 'cursor-default bg-slate-100 text-slate-500'}`} inputMode="decimal" readOnly={!isDensityEditable} value={draft.density ?? ''} placeholder="Выберите материал" onChange={(event) => update({ density: event.target.value, includeMass: true })} />
          <p className="mt-2 text-xs leading-4 text-slate-500">Коэффициент подставляется для выбранного материала автоматически.</p>
        </div>
      </section>
      {result ? <section aria-live="polite" className="space-y-4 rounded-3xl bg-blue-50 p-5 ring-1 ring-blue-100">
        <h2 className="text-sm font-black uppercase tracking-wide text-sky-700">Итоги расчёта</h2>
        <div><p className="text-sm font-medium text-slate-600">Объём</p><p className="text-2xl font-black text-slate-900">{formatBulk(result.volume)} м³</p></div>
        <div><p className="text-sm font-medium text-slate-600">Примерный вес</p><p className="text-2xl font-black text-slate-900">{result.mass !== null ? `${formatBulk(result.mass)} тонн` : 'Укажите плотность'}</p></div>
        <div><p className="text-sm font-medium text-slate-600">Потребуется машин (по {formatBulk(result.capacity)} м³)</p><p className="text-2xl font-black text-slate-900">{result.loads} шт.</p></div>
        <p className="border-t border-blue-100 pt-3 text-sm leading-5 text-slate-600">Рейсы: {describeLoads(result)}. Итог не учитывает запас, уплотнение и влажность.</p>
      </section> : <p aria-live="polite" className="rounded-xl bg-white p-3 text-sm text-slate-600 shadow-sm">{validation}</p>}
      <button disabled={!result || !material} className="w-full rounded-2xl bg-sky-500 p-4 font-black text-white shadow-sm transition hover:bg-sky-600 disabled:opacity-40" onClick={() => {
        setContext({ ...draft, density: draft.density });
        onChooseSupplier(draft.materialId);
      }}>Выбрать поставщика</button>
      <p className="text-center text-sm leading-5 text-slate-500">Расчёт не добавляет товары в корзину. Оформите нужные машины в каталоге.</p>
      <button type="button" onClick={onGoToCatalog} className="mb-3 w-full rounded-2xl bg-blue-600 p-4 font-black text-white shadow-sm transition hover:bg-blue-700">Перейти в каталог</button>
    </div>
  </section>;
}
