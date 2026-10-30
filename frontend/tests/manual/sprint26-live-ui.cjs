/* Published TEST UI only; private QA identities, never customer credentials. */
const fs = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const base = 'https://test.darmavoz.ru';
const qa = JSON.parse(fs.readFileSync('/opt/darmavoz_test_backups/sprint26/qa-auth.json'));
const root = '/opt/darmavoz_test/docs/reports/sprint26';
const sizes = [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }, { width: 844, height: 390 }];
const result = { environment: 'test', checks: [], screenshots: [], physical_device: false };
async function api(route, body, actor = qa.admin) {
  const r = await fetch(base + '/api/v1' + route, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + actor.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error('QA_API_' + r.status + '_' + route);
  return r.json();
}
async function context(browser, actor) {
  const entries = [{ name: 'selected-city', value: JSON.stringify({ state: { cityId: qa.city_id }, version: 1 }) }];
  if (actor) entries.push({ name: 'auth-storage', value: JSON.stringify({ state: { token: actor.token, role: actor.role, driverId: actor.driverId || null }, version: 0 }) });
  return browser.newContext({ viewport: sizes[1], serviceWorkers: 'block', storageState: { cookies: [], origins: [{ origin: base, localStorage: entries }] } });
}
async function capture(page, label, size) {
  await page.setViewportSize(size);
  const overflow = await page.evaluate(() => {
    const shell = [...document.querySelectorAll('section.fixed')].at(-1) || document.body;
    return [...shell.querySelectorAll('*')].filter(el => {
      const box = el.getBoundingClientRect(), css = getComputedStyle(el);
      if (!(box.width > 0 && box.height > 0 && box.top < innerHeight && box.bottom > 0 && css.display !== 'none' && css.visibility !== 'hidden')) return false;
      let left = box.left, right = box.right;
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        if (['hidden', 'clip', 'auto', 'scroll'].includes(getComputedStyle(parent).overflowX)) { const clip = parent.getBoundingClientRect(); left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
      }
      return right > left && (left < -1 || right > innerWidth + 1);
    }).map(el => el.tagName + '.' + String(el.className)).slice(0, 8);
  });
  expect(overflow, label + ' overflow at ' + size.width).toEqual([]);
  const file = label + '-' + size.width + '.png';
  await page.screenshot({ path: root + '/screenshots/' + file }); result.screenshots.push(file);
}
async function profiles(browser) {
  const c = await context(browser, qa.driver); const p = await c.newPage();
  await p.goto(base + '/app');
  const access = await api('/subscriptions/me', undefined, qa.driver);
  if (access.transport_access) throw new Error('DRIVER_MUST_START_WITHOUT_ACCESS_FOR_NOTICE_CHECK');
  await expect(p.getByRole('heading', { name: 'Новые заявки доступны по подписке', exact: true })).toBeVisible({ timeout: 20000 });
  for (const size of sizes) await capture(p, 'live-driver-subscription-notice', size);
  await p.getByRole('button', { name: 'Карта материалов', exact: true }).click();
  await expect(p.getByRole('heading', { name: 'Общая карта', exact: true })).toBeVisible();
  for (const name of ['Материалы', 'Вода', 'Септики']) {
    await p.getByRole('tab', { name, exact: true }).click(); await p.waitForTimeout(1800);
    for (const size of sizes) await capture(p, 'live-public-map-' + ({ Материалы: 'materials', Вода: 'water', Септики: 'septic' }[name]), size);
  }
  result.checks.push('unsubscribed driver retains public maps and subscription CTA at all target sizes');
  await c.close();
}
async function chat(browser) {
  const member = await context(browser, qa.supplier), p = await member.newPage();
  await p.goto(base + '/app'); await p.getByRole('button', { name: 'Профиль', exact: true }).click(); await p.getByText('Общий чат', { exact: true }).click();
  const text = 'QA Спринт 26: тест восстановления связи ' + Date.now();
  await p.getByRole('textbox', { name: 'Сообщение', exact: true }).fill(text);
  await p.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  await expect(p.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('');
  const row = (await api('/chat/messages')).messages.find(m => m.text === text); if (!row) throw new Error('LIVE_CHAT_NOT_PERSISTED');
  await member.setOffline(true); await p.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('QA черновик после восстановления связи');
  await p.getByRole('button', { name: 'Отправить сообщение', exact: true }).click(); await expect(p.getByRole('alert')).toBeVisible();
  await expect(p.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('QA черновик после восстановления связи'); await member.setOffline(false);
  await api('/chat/moderation', { action: 'pin', message_id: row.id, reason: 'QA published test pin' });
  await expect(p.getByRole('heading', { name: 'Закреплённое', exact: true })).toBeVisible({ timeout: 15000 });
  for (const size of sizes) await capture(p, 'live-general-chat', size);
  await api('/chat/moderation', { action: 'delete', message_id: row.id, reason: 'QA test message cleanup' });
  await expect(p.getByText(text, { exact: true })).toHaveCount(0, { timeout: 15000 });
  const warning = 'QA проверка in-app уведомления модерации ' + Date.now();
  await api('/chat/moderation', { action: 'warn', target_id: qa.supplier.id, reason: warning });
  const notices = await api('/notifications', undefined, qa.supplier);
  if (!notices.some(n => n.body === warning)) throw new Error('QA_INAPP_WARNING_MISSING');
  result.checks.push('published chat send, offline draft, pin, delete and QA-only in-app moderation warning');
  await member.close();
}
async function journey(browser) {
  const anon = await context(browser), p = await anon.newPage(); await p.goto(base + '/app'); await p.waitForTimeout(900);
  const contact = 's26-qa-live-' + Date.now() + '@example.invalid';
  const bad = await p.evaluate(async username => (await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username, password: 'QA_DO_NOT_LOG_THIS_PASSWORD' }) })).status, contact);
  expect(bad).toBe(401); const session = await p.evaluate(() => sessionStorage.getItem('darmavoz.s26.session'));
  const before = await api('/admin/journeys/' + session); expect(before.session.actor_id).toBeNull(); expect(before.session.city_id).toBe(qa.city_id);
  const failed = before.attempts.find(a => a.has_contact); if (!failed) throw new Error('ANONYMOUS_FAILURE_WITH_CONTACT_MISSING');
  if (JSON.stringify(before).includes(contact) || JSON.stringify(before).includes('QA_DO_NOT_LOG')) throw new Error('UNMASKED_SECRET_IN_JOURNEY');
  await anon.setOffline(true); await p.evaluate(async () => { try { await fetch('/api/v1/auth/login', { method: 'POST', body: '{}' }); } catch {} });
  const queued = await p.evaluate(() => localStorage.getItem('darmavoz.s26.events') || ''); if (!queued.includes('network_error') || queued.includes('QA_DO_NOT_LOG')) throw new Error('OFFLINE_QUEUE_INVALID');
  await anon.setOffline(false); await p.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => p.evaluate(() => JSON.parse(localStorage.getItem('darmavoz.s26.events') || '[]').length)).toBe(0);
  const good = await p.evaluate(async password => (await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: 's26-qa-release-admin', password }) })).status, qa.admin.password);
  expect(good).toBe(200); const after = await api('/admin/journeys/' + session); expect(after.session.actor_id).toBe(qa.admin.id);
  expect(after.events.some(e => e.event === 'auth_succeeded')).toBeTruthy(); expect(after.events.some(e => e.event === 'auth_failed')).toBeTruthy();
  expect(new Set(after.events.map(e => e.id)).size).toBe(after.events.length);
  const filtered = await api('/admin/journeys?city_id=' + qa.city_id); expect(filtered.items.some(i => i.id === session)).toBeTruthy();
  const admin = await context(browser, qa.admin), a = await admin.newPage(); await a.goto(base + '/admin/journeys?session=' + session);
  await expect(a.getByRole('heading', { name: 'Хронология', exact: true })).toBeVisible();
  await a.getByRole('button', { name: 'Показать контакт (запись в журнале)', exact: true }).first().click(); await expect(a.getByText(contact, { exact: true })).toBeVisible();
  for (const size of sizes) await capture(a, 'live-journey-verified-history', size);
  const notices = await api('/notifications');
  const linked = notices.filter(n => n.payload?.journey_session_id === session || n.payload?.path?.includes(session));
  result.checks.push('anonymous failure retained after verified login, city filter, masked contact/audited reveal, offline flush, dedup');
  result.journey = { session_id: session, event_count: after.events.length, actor_linked: true, city_filter: true, owner_inapp_count: linked.length };
  await admin.close(); await anon.close();
}
async function owner(browser) {
  const c = await context(browser), p = await c.newPage(); await p.goto(base + '/app');
  const contact = 's26-qa-owner-' + Date.now() + '@example.invalid';
  for (let i = 0; i < 3; i++) {
    const status = await p.evaluate(async username => (await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username, password: 'QA_OWNER_INVALID_LOGIN' }) })).status, contact);
    expect(status).toBe(401);
  }
  const session = await p.evaluate(() => sessionStorage.getItem('darmavoz.s26.session'));
  const cfg = await api('/subscriptions/admin/settings');
  if (cfg.owner_id !== qa.admin.id || !cfg.notify_inapp) throw new Error('QA_OWNER_REQUIRED');
  const polls = Math.ceil((Number(cfg.input_group_minutes) * 60 + 60) / 10); let linked = [];
  console.log(JSON.stringify({ owner_check: 'waiting for configured input grouping', session_id: session, group_minutes: cfg.input_group_minutes }));
  for (let i = 0; i < polls; i++) {
    try { linked = (await api('/notifications?limit=100')).filter(n => n.payload?.journey_session_id === session); } catch { /* deploy may briefly recreate backend */ }
    if (linked.length) break;
    await p.waitForTimeout(10000);
  }
  expect(linked).toHaveLength(1);
  const detail = await api('/admin/journeys/' + session); expect(detail.incidents.some(i => i.count >= 3 && i.notified)).toBeTruthy();
  const admin = await context(browser, qa.admin), a = await admin.newPage();
  await a.goto(base + linked[0].payload.path); await expect(a.getByRole('heading', { name: 'Хронология', exact: true })).toBeVisible();
  for (const size of [sizes[1], sizes[4]]) await capture(a, 'live-owner-notification-target', size);
  result.checks.push('three QA login failures grouped into one in-app owner notification; configured deep link opens chronology');
  result.owner = { session_id: session, notification_count: linked.length, grouped_failures: 3, recipient: 'QA admin only', physical_push: 'not verified' };
  await admin.close(); await c.close();
}
(async () => {
  if ((await api('/payments/config')).test_mode !== true) throw new Error('TEST_SHOP_REQUIRED');
  const b = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
  try { for (const task of process.argv.slice(2).length ? process.argv.slice(2) : ['profiles', 'chat', 'journey']) await ({ profiles, chat, journey, owner }[task])(b); result.ok = true; }
  finally { fs.writeFileSync(root + '/live-ui-' + (process.argv.slice(2).join('-') || 'all') + '.json', JSON.stringify(result, null, 2) + '\n'); await b.close(); }
  console.log(JSON.stringify(result));
})().catch(e => { console.error(String(e.message).replace(/https?:\/\/\S+/g, '[URL]')); process.exit(1); });
