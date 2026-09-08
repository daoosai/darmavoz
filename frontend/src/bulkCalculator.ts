export interface BulkInput {
  length: string;
  width: string;
  thickness: string;
  thicknessUnit: 'cm' | 'm';
  capacity: string;
  density?: string;
}

type Decimal = { n: bigint; d: bigint };
const multiply = (a: Decimal, b: Decimal): Decimal => ({ n: a.n * b.n, d: a.d * b.d });

function decimal(value: string, label: string): Decimal {
  const normalized = value.trim().replace(',', '.');
  if (normalized.length > 200 || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
    throw new Error(`${label}: введите положительное число`);
  }
  const [whole, fraction = ''] = normalized.split('.');
  const n = BigInt((whole || '0') + fraction);
  if (n <= 0n) throw new Error(`${label}: значение должно быть больше нуля`);
  return { n, d: 10n ** BigInt(fraction.length) };
}

function numeric(value: Decimal): number {
  // Denominators are powers of ten; avoid intermediate Infinity / Infinity.
  const result = Number(`${value.n}e-${value.d.toString().length - 1}`);
  if (!Number.isFinite(result) || result <= 0) throw new Error('Результат выходит за допустимый диапазон');
  return result;
}

export function calculateBulk(input: BulkInput) {
  const length = decimal(input.length, 'Длина');
  const width = decimal(input.width, 'Ширина');
  const thickness = decimal(input.thickness, 'Толщина');
  if (input.thicknessUnit === 'cm') thickness.d *= 100n;
  const volumeExact = multiply(multiply(length, width), thickness);
  const capacityExact = decimal(input.capacity, 'Кубатура');
  const numerator = volumeExact.n * capacityExact.d;
  const denominator = volumeExact.d * capacityExact.n;
  // Exact decimal arithmetic: never round the volume before ceil.
  const count = (numerator + denominator - 1n) / denominator;
  if (count > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Слишком большое количество загрузок');
  const remainder = numerator % denominator;
  const lastExact = remainder === 0n ? capacityExact : {
    n: remainder, d: volumeExact.d * capacityExact.d,
  };
  return {
    volume: numeric(volumeExact),
    mass: input.density?.trim() ? numeric(multiply(volumeExact, decimal(input.density, 'Плотность'))) : null,
    capacity: numeric(capacityExact),
    loads: Number(count),
    lastLoad: numeric(lastExact),
  };
}

export function formatBulk(value: number): string {
  if (value > 0 && value < 0.001) return '< 0,001';
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
}

export function describeLoads(result: ReturnType<typeof calculateBulk>): string {
  if (result.loads === 1) return `${formatBulk(result.lastLoad)} м³`;
  if (result.loads <= 5) return [...Array(result.loads - 1).fill(formatBulk(result.capacity)), formatBulk(result.lastLoad)].join(' + ') + ' м³';
  return `${result.loads - 1} × ${formatBulk(result.capacity)} + ${formatBulk(result.lastLoad)} м³`;
}
