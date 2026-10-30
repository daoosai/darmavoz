import { useState } from 'react';
import CommerceShell from './CommerceShell';
import GlobalMapScreen from './GlobalMapScreen';
import WaterMapScreen from './WaterMapScreen';
export default function PublicCatalogMap({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'materials' | 'water' | 'septic'>('materials');
  return <CommerceShell wide title="Общая карта" subtitle="Карта доступна независимо от подписки" onClose={onClose}>
    <div role="tablist" aria-label="Раздел карты" className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">{([['materials', 'Материалы'], ['water', 'Вода'], ['septic', 'Септики']] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} className={`min-h-11 rounded-lg px-2 text-sm font-bold ${tab === value ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500'}`} onClick={() => setTab(value)}>{label}</button>)}</div>
    <div className="h-[max(30rem,calc(100dvh-16rem))] overflow-hidden rounded-2xl border border-slate-100 bg-white">{tab === 'materials' ? <GlobalMapScreen isAuthenticated onOpenAuth={() => {}} /> : <div key={tab} className="h-full"><WaterMapScreen initialTab={tab} /></div>}</div>
  </CommerceShell>;
}
