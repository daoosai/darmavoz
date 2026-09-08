import { useEffect, useState } from 'react';
import { baseURL } from './utils';
import { calculateBulk, describeLoads, formatBulk } from './bulkCalculator';
import { useCalculatorStore } from './calculatorStore';

type References = {
  materials: { id: string; name: string; bulk_density_t_m3: number | null }[];
  delivery_options: { id: string; title: string; capacity_m3: number }[];
};

export default function BulkCalculatorScreen({ materialId, onClose, onChooseSupplier }: {
  materialId?: string; onClose: () => void; onChooseSupplier: (id: string) => void;
}) {
  const { draft, update, setContext } = useCalculatorStore();
  const [references, setReferences] = useState<References | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
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
          if (material) update({ materialId, density: material.bulk_density_t_m3?.toString() ?? '' });
        }
      }).catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [materialId, update, attempt]);

  let result: ReturnType<typeof calculateBulk> | null = null;
  let validation = '';
  try {
    result = calculateBulk({ ...draft, density: draft.includeMass ? draft.density : '' });
  } catch (err) { validation = (err as Error).message; }
  const material = references?.materials.find((item) => item.id === draft.materialId);
  const inputClass = 'w-full rounded-xl border border-slate-200 p-3';
  return <section role="dialog" aria-modal="true" aria-label="Калькулятор материалов" className="fixed inset-0 z-[100] overflow-y-auto bg-white pt-[max(env(safe-area-inset-top),2.5rem)] pb-[max(env(safe-area-inset-bottom),1rem)]">
    <div className="mx-auto max-w-md space-y-4 px-4">
      <button onClick={onClose} className="py-2 text-sky-600">← Назад</button>
      <h1 className="text-2xl font-bold">Калькулятор материалов</h1>
      <p className="text-sm text-slate-500">Рассчитайте объём слоя и количество загрузок. Запас, уплотнение и влажность автоматически не учитываются.</p>
      {error && <p role="alert">{error} <button className="text-sky-600" onClick={() => setAttempt(attempt + 1)}>Повторить</button></p>}
      {!references && !error && <p>Загрузка справочников…</p>}
      <label className="block">Материал<select aria-label="Материал" className={inputClass} value={material?.id ?? ''} onChange={(event) => {
        const next = references?.materials.find((item) => item.id === event.target.value);
        update({ materialId: event.target.value, density: next?.bulk_density_t_m3?.toString() ?? '' });
      }}><option value="">Выберите материал</option>{references?.materials.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {references?.materials.length === 0 && <p>Материалы для расчёта пока не настроены.</p>}
      {([['length', 'Длина, м'], ['width', 'Ширина, м'], ['thickness', 'Толщина слоя']] as const).map(([field, label]) => <label key={field} className="block">{label}<input aria-label={label} className={inputClass} inputMode="decimal" value={draft[field]} onChange={(event) => update({ [field]: event.target.value })} /></label>)}
      <label className="block">Единица толщины<select className={inputClass} value={draft.thicknessUnit} onChange={(event) => update({ thicknessUnit: event.target.value as 'cm' | 'm' })}><option value="cm">Сантиметры</option><option value="m">Метры</option></select></label>
      <label className="block">Кубатура из справочника<select className={inputClass} value="" onChange={(event) => { if (event.target.value) update({ capacity: event.target.value }); }}><option value="">Выберите или введите ниже</option>{references?.delivery_options.map((item) => <option key={item.id} value={item.capacity_m3}>{item.title} — {item.capacity_m3} м³</option>)}</select></label>
      <label className="block">Кубатура машины, м³<input className={inputClass} inputMode="decimal" value={draft.capacity} onChange={(event) => update({ capacity: event.target.value })} /></label>
      <label className="flex gap-2"><input type="checkbox" checked={draft.includeMass} onChange={(event) => update({ includeMass: event.target.checked })} /> Рассчитать ориентировочный тоннаж</label>
      {draft.includeMass && <label className="block">Плотность, т/м³<input className={inputClass} inputMode="decimal" value={draft.density ?? ''} placeholder="Введите коэффициент, если известен" onChange={(event) => update({ density: event.target.value })} /></label>}
      {result ? <div aria-live="polite" className="space-y-2 rounded-2xl bg-sky-50 p-4">
        <p className="text-lg font-bold">Нужно {formatBulk(result.volume)} м³ материала</p>
        {result.mass !== null && <p>Ориентировочный тоннаж: {formatBulk(result.mass)} т</p>}
        {draft.includeMass && result.mass === null && <p>Для тоннажа введите плотность.</p>}
        <p>Машин/рейсов: {result.loads}. Загрузки: {describeLoads(result)}.</p>
        <p className="text-sm">Это число загрузок, а не разных автомобилей. Остаток потребности не означает тарификацию неполной машины.</p>
      </div> : <p aria-live="polite" className="text-sm text-slate-600">{validation}</p>}
      <button disabled={!result || !material} className="w-full rounded-xl bg-sky-500 p-3 font-bold text-white disabled:opacity-40" onClick={() => {
        setContext({ ...draft, density: draft.includeMass ? draft.density : '' });
        onChooseSupplier(draft.materialId);
      }}>Выбрать поставщика</button>
      <p className="text-sm text-slate-500">Оформляется одна машина. Остальные рейсы оформляются отдельно. Расчёт автоматически в корзину не добавляется.</p>
    </div>
  </section>;
}
