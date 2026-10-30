import { useCallback, useEffect, useState } from 'react';
import { commerceApi, buttonClass } from './commerceApi';
import SubscriptionsScreen from './SubscriptionsScreen';
import PublicCatalogMap from './PublicCatalogMap';
import { useAuthStore } from './store';
interface Status { enabled: boolean; transport_access?: boolean }
export default function DriverSubscriptionNotice() {
  const token = useAuthStore(state => state.token);
  const [status, setStatus] = useState<Status | null>(null), [error, setError] = useState(false);
  const [view, setView] = useState<'subscription' | 'map' | null>(null);
  const load = useCallback(async () => { try { setStatus(await commerceApi('/subscriptions/me')); setError(false); } catch { setError(true); } }, []);
  useEffect(() => { if (!token) return; void load(); const timer = window.setInterval(() => void load(), 15000); window.addEventListener('online', load); return () => { window.clearInterval(timer); window.removeEventListener('online', load); }; }, [token, load]);
  if (!status?.enabled || (status.transport_access && !view)) return null;
  return <><section aria-label="Доступ к новым заявкам" className="mx-4 mt-4 space-y-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
    <h2 className="font-bold">Новые заявки доступны по подписке</h2>
    <p>Активируйте бесплатные 14 дней или выберите подписку. Если пробный период этой машины уже использован, потребуется платный тариф.</p>
    <p className="text-xs">Уже принятый рейс можно завершить. Карта и общедоступные возможности остаются доступны.</p>
    {error && <p role="status" className="text-xs">Не удалось обновить срок доступа. Проверим после восстановления связи.</p>}
    <div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={() => setView('subscription')}>Выбрать подписку</button><button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-sky-200 bg-white px-4 py-3 text-sm font-bold text-sky-700 transition hover:bg-sky-50" onClick={() => setView('map')}>Карта материалов</button></div>
  </section>{view === 'subscription' && <SubscriptionsScreen onClose={() => { setView(null); void load(); }} />}{view === 'map' && <PublicCatalogMap onClose={() => setView(null)} />}</>;
}
