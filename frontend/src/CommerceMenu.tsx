import { useEffect, useState } from 'react';
import { ChevronRight, ClipboardList, Wallet } from 'lucide-react';
import { useAuthStore } from './store';
import WholesaleScreen from './WholesaleScreen';
import FinanceScreen from './FinanceScreen';
import SubscriptionsScreen from './SubscriptionsScreen';
import GeneralChatScreen from './GeneralChatScreen';
import AdminSubscriptionsScreen from './AdminSubscriptionsScreen';
import AdminJourneysScreen from './AdminJourneysScreen';
import { commerceApi } from './commerceApi';

export default function CommerceMenu({ onOpenWholesale }: { onOpenWholesale?: () => void }) {
  const { role, token } = useAuthStore();
  const [view, setView] = useState<'wholesale' | 'finance' | 'subscriptions' | 'chat' | 'admin_subscriptions' | 'journeys' | null>(null);
  const staff = role === 'admin' || role === 'logist';
  const wholesaleRole = staff || role === 'driver' || role === 'supplier';
  const [features, setFeatures] = useState({ enabled: false, chat_enabled: false });
  useEffect(() => { if (token) void commerceApi('/subscriptions/features').then(setFeatures).catch(() => {}); }, [token, view]);
  if (!token || (!wholesaleRole && !features.enabled && !features.chat_enabled)) return null;
  return <><div className="space-y-2 rounded-2xl border border-slate-100 bg-white p-2 shadow-sm">
    {role === 'admin' && <button className="flex min-h-14 w-full items-center justify-between rounded-xl px-3 py-3 text-left hover:bg-sky-50" onClick={() => setView('journeys')}><span><span className="block text-sm font-bold text-slate-800">Путь пользователя</span><span className="mt-1 block text-xs text-slate-400">Посетители, попытки и проблемы</span></span><ChevronRight className="h-4 w-4 text-slate-300" /></button>}
    {role === 'admin' && <button className="flex min-h-14 w-full items-center justify-between rounded-xl px-3 py-3 text-left hover:bg-sky-50" onClick={() => setView('admin_subscriptions')}><span><span className="block text-sm font-bold text-slate-800">Управление подписками</span><span className="mt-1 block text-xs text-slate-400">Тарифы, сроки, возвраты и настройки</span></span><ChevronRight className="h-4 w-4 text-slate-300" /></button>}
    {features.enabled && <button className="flex min-h-14 w-full items-center justify-between rounded-xl px-3 py-3 text-left hover:bg-sky-50" onClick={() => setView('subscriptions')}><span><span className="block text-sm font-bold text-slate-800">Подписки</span><span className="mt-1 block text-xs text-slate-400">Пробный период, тарифы и история оплат</span></span><ChevronRight className="h-4 w-4 text-slate-300" /></button>}
    {features.chat_enabled && <button className="flex min-h-14 w-full items-center justify-between rounded-xl px-3 py-3 text-left hover:bg-sky-50" onClick={() => setView('chat')}><span><span className="block text-sm font-bold text-slate-800">Общий чат</span><span className="mt-1 block text-xs text-slate-400">Общение с участниками платформы</span></span><ChevronRight className="h-4 w-4 text-slate-300" /></button>}
    {wholesaleRole && <button className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-sky-50" onClick={() => role === 'admin' ? window.location.assign('/admin/wholesale') : onOpenWholesale ? onOpenWholesale() : setView('wholesale')}><div className="rounded-xl bg-sky-50 p-2.5 text-sky-500"><ClipboardList className="h-5 w-5" /></div><div className="flex-1"><p className="text-sm font-bold text-slate-800">Оптовые заявки</p><p className="mt-0.5 text-xs text-slate-400">Крупные объёмы и поиск перевозчиков</p></div><ChevronRight className="h-4 w-4 text-slate-300" /></button>}
    {staff && <button className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-sky-50" onClick={() => setView('finance')}><div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-500"><Wallet className="h-5 w-5" /></div><div className="flex-1"><p className="text-sm font-bold text-slate-800">Финансы</p><p className="mt-0.5 text-xs text-slate-400">Платежи, отчёты и сверка</p></div><ChevronRight className="h-4 w-4 text-slate-300" /></button>}
  </div>{view === 'journeys' && <AdminJourneysScreen onClose={() => setView(null)} />}{view === 'admin_subscriptions' && <AdminSubscriptionsScreen onClose={() => setView(null)} />}{view === 'subscriptions' && <SubscriptionsScreen onClose={() => setView(null)} />}{view === 'chat' && <GeneralChatScreen onClose={() => setView(null)} />}{view === 'wholesale' && <WholesaleScreen onClose={() => setView(null)} />}{view === 'finance' && <FinanceScreen onClose={() => setView(null)} />}</>;
}
