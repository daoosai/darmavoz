import { useState } from 'react';
import { ChevronRight, ClipboardList, Wallet } from 'lucide-react';
import { useAuthStore } from './store';
import WholesaleScreen from './WholesaleScreen';
import FinanceScreen from './FinanceScreen';

export default function CommerceMenu({ onOpenWholesale }: { onOpenWholesale?: () => void }) {
  const { role, token } = useAuthStore();
  const [view, setView] = useState<'wholesale' | 'finance' | null>(null);
  const staff = role === 'admin' || role === 'logist';
  const wholesaleRole = staff || role === 'driver' || role === 'supplier';
  if (!token || !wholesaleRole) return null;
  return <><div className="space-y-2 rounded-2xl border border-slate-100 bg-white p-2 shadow-sm">
    {wholesaleRole && <button className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-sky-50" onClick={() => role === 'admin' ? window.location.assign('/admin/wholesale') : onOpenWholesale ? onOpenWholesale() : setView('wholesale')}><div className="rounded-xl bg-sky-50 p-2.5 text-sky-500"><ClipboardList className="h-5 w-5" /></div><div className="flex-1"><p className="text-sm font-bold text-slate-800">Оптовые заявки</p><p className="mt-0.5 text-xs text-slate-400">Крупные объёмы и поиск перевозчиков</p></div><ChevronRight className="h-4 w-4 text-slate-300" /></button>}
    {staff && <button className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-sky-50" onClick={() => setView('finance')}><div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-500"><Wallet className="h-5 w-5" /></div><div className="flex-1"><p className="text-sm font-bold text-slate-800">Финансы</p><p className="mt-0.5 text-xs text-slate-400">Платежи, отчёты и сверка</p></div><ChevronRight className="h-4 w-4 text-slate-300" /></button>}
  </div>{view === 'wholesale' && <WholesaleScreen onClose={() => setView(null)} />}{view === 'finance' && <FinanceScreen onClose={() => setView(null)} />}</>;
}
