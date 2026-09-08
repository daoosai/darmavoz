import { calculateBulk, formatBulk } from './bulkCalculator';
import { useCalculatorStore } from './calculatorStore';

export default function CalculatorReminder({ materialId, capacity }: { materialId: string; capacity?: number }) {
  const context = useCalculatorStore((state) => state.context);
  if (!context || context.materialId !== materialId) return null;
  try {
    const result = calculateBulk({ ...context, capacity: capacity?.toString() ?? context.capacity });
    return <p className="rounded-xl bg-sky-50 p-3 text-sm">Потребность: {formatBulk(result.volume)} м³. При кузове {formatBulk(result.capacity)} м³ — {result.loads} загрузок. Оформляется одна машина, остальные рейсы отдельно.</p>;
  } catch { return null; }
}
