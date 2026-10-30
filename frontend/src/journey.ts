/** Bounded, contact-free offline event queue. Success is recorded by the backend. */
import { baseURL } from './utils';
import { useAuthStore } from './store';
import { useCityStore } from './cityStore';
type Kind = 'auth' | 'order' | 'subscription' | 'navigation' | 'receipt' | 'review';
interface Event { id: string; visitor_id: string; session_id: string; attempt_id: string | null; kind: Kind; event: string; occurred_at: string; details: Record<string, string | boolean> }
const QUEUE = 'darmavoz.s26.events';
const attempts: Partial<Record<Kind, string>> = {};
let visitor = '', session = '', flushing = false, installed = false;
let nativeFetch: typeof window.fetch;
function cityHeaders(): Record<string, string> { const id = useCityStore.getState().cityId; return id && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id) ? { 'X-Journey-City-Id': id } : {}; }
function stored(storage: Storage, key: string) { let id = storage.getItem(key); if (!id) { id = crypto.randomUUID(); storage.setItem(key, id); } return id; }
function queue(): Event[] { try { const items = JSON.parse(localStorage.getItem(QUEUE) || '[]'); return Array.isArray(items) ? items.filter(x => x && typeof x.id === 'string' && Date.now() - Date.parse(x.occurred_at) < 7 * 86400000).slice(-200) : []; } catch { return []; } }
function save(events: Event[]) { try { localStorage.setItem(QUEUE, JSON.stringify(events.slice(-200))); } catch { /* Analytics never blocks application use. */ } }
export function trackJourney(kind: Kind, event: string, details: Event['details'] = {}, fresh = false, attemptOverride?: string) {
  if (!installed) return;
  if (kind !== 'navigation' && (fresh || !attempts[kind])) attempts[kind] = crypto.randomUUID();
  save([...queue(), { id: crypto.randomUUID(), visitor_id: visitor, session_id: session, attempt_id: attemptOverride || attempts[kind] || null, kind, event, occurred_at: new Date().toISOString(), details }]);
  void flush();
}
async function flush() {
  if (!installed || flushing || !navigator.onLine) return;
  const batch = queue().slice(0, 30); if (!batch.length) return;
  flushing = true;
  try {
    const response = await nativeFetch(`${baseURL}/telemetry/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...cityHeaders() }, body: JSON.stringify({ events: batch }) });
    if (!response.ok) { if ([400, 422].includes(response.status)) { const ids = new Set(batch.map(x => x.id)); save(queue().filter(x => !ids.has(x.id))); } return; }
    const result = await response.json(); const accepted = new Set<string>(result.accepted || []);
    if (result.enabled === false) save([]); else save(queue().filter(x => !accepted.has(x.id)));
  } catch { /* Retry the same event IDs after recovery. */ } finally { flushing = false; }
}
function checkoutAttempt(requestKey: string) {
  const key = session + ':' + requestKey;
  try {
    const rows = JSON.parse(sessionStorage.getItem('darmavoz.s26.checkout-attempts') || '{}') as Record<string, string>;
    if (!rows[key]) rows[key] = crypto.randomUUID();
    const entries = Object.entries(rows).slice(-100); sessionStorage.setItem('darmavoz.s26.checkout-attempts', JSON.stringify(Object.fromEntries(entries)));
    return rows[key];
  } catch { return crypto.randomUUID(); }
}
function kindFor(path: string): Kind | null {
  if (/\/(auth|client-auth|supplier-auth|equipment-owner-auth|water-septic-partner-auth)\//.test(path)) return 'auth';
  if (/\/subscriptions\/payments$/.test(path)) return 'subscription';
  if (/\/orders\/[^/]+\/received$/.test(path)) return 'receipt';
  if (/\/orders\/[^/]+\/review$/.test(path)) return 'review';
  if (/\/orders\/checkout$/.test(path) || /\/client\/orders$/.test(path)) return 'order';
  return null;
}
export function installJourney() {
  if (installed) return;
  try { visitor = stored(localStorage, 'darmavoz.s26.visitor'); session = stored(sessionStorage, 'darmavoz.s26.session'); } catch { return; }
  installed = true; nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.href);
    const api = new URL(baseURL, window.location.href);
    if (url.origin !== api.origin || !url.pathname.startsWith(api.pathname) || url.pathname.includes('/telemetry/')) return nativeFetch(input, init);
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const kind = ['POST', 'PATCH'].includes(method) ? kindFor(url.pathname) : null;
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    let requestAttempt: string | undefined;
    if (kind) {
      if (kind === 'subscription' && !attempts[kind]) trackJourney(kind, 'subscription_started');
      else if (kind === 'auth') trackJourney(kind, 'auth_submitted');
      else if (!attempts[kind]) trackJourney(kind, kind === 'receipt' ? 'receipt_started' : kind === 'review' ? 'review_started' : 'order_started');
    }
    if (kind === 'order') { requestAttempt = checkoutAttempt(headers.get('Idempotency-Key') || crypto.randomUUID()); headers.set('X-Cart-Attempt-Id', attempts.order!); trackJourney('order', 'order_submitted', { screen: 'cart' }, false, requestAttempt); }
    headers.set('X-Visitor-Id', visitor); headers.set('X-Session-Id', session);
    for (const [key, value] of Object.entries(cityHeaders())) headers.set(key, value);
    if (kind) { headers.set('X-Attempt-Id', requestAttempt || attempts[kind]!); headers.set('X-Attempt-Kind', kind); }
    try { return await nativeFetch(input, { ...init, headers }); }
    catch (error) { if (kind) trackJourney(kind, 'network_error', { online: navigator.onLine, error_code: 'NETWORK_UNAVAILABLE' }, false, requestAttempt); throw error; }
  };
  let previous = useAuthStore.getState().token;
  useAuthStore.subscribe(state => {
    if (previous && previous !== state.token) {
      session = crypto.randomUUID(); try { sessionStorage.setItem('darmavoz.s26.session', session); } catch { /* Memory session remains usable. */ }
      for (const key of Object.keys(attempts)) delete attempts[key as Kind];
    }
    previous = state.token;
  });
  window.addEventListener('online', () => void flush()); window.setInterval(() => void flush(), 10000);
  let lastCity = useCityStore.getState().cityId;
  useCityStore.subscribe(state => { if (state.cityId !== lastCity) { lastCity = state.cityId; trackJourney('navigation', 'screen_opened', { screen: 'app' }); } });
  trackJourney('navigation', 'opened', { screen: 'app' });
}
