import { useEffect } from 'react';
import { useAuthStore } from './store';
import { useOperatorCityStore } from './operatorCityStore';
const seenPushEvents = new Set<string>();
export function isDuplicatePush(data?: Record<string, unknown> | null): boolean {
  const id = data?.event_id;
  if (typeof id !== 'string' || !id) return false;
  if (seenPushEvents.has(id)) return true;
  seenPushEvents.add(id);
  if (seenPushEvents.size > 200) seenPushEvents.delete(seenPushEvents.values().next().value!);
  return false;
}
const validId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
export function openNotificationTarget(data?: Record<string, unknown> | null) {
  if (!data) return;
  const role = useAuthStore.getState().role;
  const params = new URLSearchParams();
  let path = '/';
  if (validId(data.order_id)) {
    params.set('notification_order', data.order_id);
    if (role === 'admin' || role === 'logist') {
      path = role === 'admin' ? '/admin/orders' : '/logist/orders';
      if (validId(data.city_id)) useOperatorCityStore.getState().choose(data.city_id);
    } else if (role === 'client') path = '/client/orders/' + data.order_id;
  } else if (validId(data.entity_id)) {
    params.set('notification_entity', data.entity_id);
    params.set('entity_type', String(data.entity_type || ''));
  } else return;
  window.location.assign(path + '?' + params.toString());
}
export function useNotificationFocus(dependency: unknown) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('notification_order') || params.get('notification_entity');
    if (!validId(id)) return;
    const target = document.querySelector('[data-entity-id="' + id + '"], [data-order-id="' + id + '"]');
    if (target) { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); target.classList.add('ring-2', 'ring-sky-400'); }
  }, [dependency]);
}
