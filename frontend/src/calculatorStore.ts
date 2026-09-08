import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BulkInput } from './bulkCalculator';

export type CalculatorDraft = BulkInput & { materialId: string; includeMass: boolean };
const initial: CalculatorDraft = {
  length: '', width: '', thickness: '', thicknessUnit: 'cm', capacity: '',
  density: '', materialId: '', includeMass: false,
};

export const useCalculatorStore = create<{
  draft: CalculatorDraft;
  context: CalculatorDraft | null;
  update: (patch: Partial<CalculatorDraft>) => void;
  setContext: (context: CalculatorDraft | null) => void;
}>()(persist((set) => ({
  draft: initial, context: null,
  update: (patch) => set((state) => ({ draft: { ...state.draft, ...patch } })),
  setContext: (context) => set({ context }),
}), { name: 'bulk-calculator', version: 1 }));
