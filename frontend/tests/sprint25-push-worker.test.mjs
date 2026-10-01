import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function worker() {
  const hooks = []; const notices = []; const opened = [];
  const listeners = {}; let background;
  runInNewContext(readFileSync(new URL('../public/firebase-messaging-sw.js', import.meta.url), 'utf8'), {
    URLSearchParams,
    importScripts: () => hooks.push('fcm'),
    firebase: { initializeApp() {}, messaging: () => ({ onBackgroundMessage(callback) { background = callback; } }) },
    self: { addEventListener(type, callback) { hooks.push(type); listeners[type] = callback; }, registration: { showNotification(title, options) { notices.push({ title, options }); return Promise.resolve(); } } },
    clients: { openWindow(url) { opened.push(url); return Promise.resolve(); } },
  });
  return { hooks, notices, opened, listeners, background };
}

test('custom click listener precedes FCM initialization', () => {
  assert.equal(worker().hooks[0], 'notificationclick');
});

test('notification payload is displayed by FCM once; data-only message retains event identity', () => {
  const state = worker();
  state.background({ notification: { title: 'Заказ' }, data: { event_id: 'event-1' } });
  assert.equal(state.notices.length, 0);
  state.background({ data: { title: 'Заказ', body: 'Откройте карточку', event_id: 'event-2' } });
  assert.equal(state.notices.length, 1);
  assert.equal(state.notices[0].options.tag, 'event-2');
  assert.equal(state.notices[0].options.data.event_id, 'event-2');
});

test('FCM click opens the correct order and city and consumes the SDK click', async () => {
  const state = worker(); const order = '11111111-1111-4111-8111-111111111111';
  let consumed = false; let closed = false; let work;
  state.listeners.notificationclick({
    stopImmediatePropagation() { consumed = true; },
    notification: { close() { closed = true; }, data: { FCM_MSG: { data: { order_id: order, city_id: 'city-qa' } } } },
    waitUntil(promise) { work = promise; },
  });
  await work;
  assert.ok(consumed && closed);
  assert.equal(state.opened.length, 1);
  const params = new URL(state.opened[0], 'http://localhost').searchParams;
  assert.equal(params.get('notification_order'), order);
  assert.equal(params.get('notification_city'), 'city-qa');
});
