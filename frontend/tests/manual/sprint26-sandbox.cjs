/* Explicit test-only sandbox flow. Private QA credentials/confirmation URLs never enter reports. */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = '/opt/darmavoz_test_backups/sprint26';
const authPath = path.join(root, 'qa-auth.json');
const fixture = JSON.parse(fs.readFileSync(authPath, 'utf8'));
const base = 'https://test.darmavoz.ru';
const screenshots = '/opt/darmavoz_test/docs/reports/sprint26/screenshots';
async function api(route, body, actor = fixture.supplier) {
  const response = await fetch(base + '/api/v1' + route, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + actor.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const value = await response.json();
  if (!response.ok) throw new Error('Test API ' + route + ': ' + response.status + ' ' + (typeof value.detail === 'string' ? value.detail : value.detail?.message || 'request rejected'));
  return value;
}
async function go(page, url) { for (let attempt = 0; ; attempt++) { try { await page.goto(url, { waitUntil: 'domcontentloaded' }); return; } catch (error) { if (attempt >= 2 || !String(error.message).includes('ERR_NETWORK_CHANGED')) throw error; await page.waitForTimeout(700); } } }
async function main() {
  if ((await api('/payments/config')).test_mode !== true) throw new Error('TEST_SHOP_REQUIRED');
  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', storageState: { cookies: [], origins: [{ origin: base, localStorage: [{ name: 'auth-storage', value: JSON.stringify({ state: { token: fixture.supplier.token, role: 'supplier' }, version: 0 }) }, { name: 'selected-city', value: JSON.stringify({ state: { cityId: fixture.city_id }, version: 1 }) }] }] } });
  const page = await context.newPage(); fs.mkdirSync(screenshots, { recursive: true });
  try {
    if (process.argv[2] === 'prepare') {
      await page.addInitScript(({ actor, city }) => {
        localStorage.setItem('auth-storage', JSON.stringify({ state: { token: actor.token, role: actor.role }, version: 0 }));
        localStorage.setItem('selected-city', JSON.stringify({ state: { cityId: city }, version: 1 }));
      }, { actor: fixture.supplier, city: fixture.city_id });
      const partial = process.argv[3] === 'partial';
      if (partial) {
        const plans = await api('/subscriptions/admin/plans', undefined, fixture.admin);
        if (!plans.some(p => p.name === 'QA sandbox partial refund 10 RUB' && p.test_only && p.published))
          await api('/subscriptions/admin/plans', { category: 'quarry', name: 'QA sandbox partial refund 10 RUB', months: 3, amount: '10.00', published: true, test_only: true }, fixture.admin);
      }
      await go(page, base + '/app'); await page.getByRole('button', { name: 'Профиль', exact: true }).click();
      await page.getByText('Подписки', { exact: true }).click();
      await page.getByLabel('Почта для чека', { exact: true }).fill('s26-qa-receipt@example.invalid');
      const section = page.getByRole('heading', { name: 'Карьеры', exact: true }).locator('xpath=ancestor::section[1]');
      const created = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/subscriptions/payments');
      await section.getByRole('button', { name: partial ? /^3 мес\..*10/ : /^1 мес\./ }).click();
      const response = await created;
      if (response.status() !== 202) throw new Error('Subscription create status ' + response.status());
      const initial = await response.json(); let payment;
      for (let i = 0; i < 40; i++) {
        payment = await api('/subscriptions/payments/' + initial.id);
        if (payment.confirmation_url || ['failed', 'manual_review', 'canceled'].includes(payment.status)) break;
        await page.waitForTimeout(1000);
      }
      if (payment.status !== 'pending' || !payment.confirmation_url) throw new Error('Provider link not ready: ' + payment.status + '/' + payment.last_error);
      const url = new URL(payment.confirmation_url);
      if (url.protocol !== 'https:' || !['yoomoney.ru', 'yookassa.ru'].some(host => url.hostname === host || url.hostname.endsWith('.' + host))) throw new Error('UNEXPECTED_PROVIDER_HOST');
      fixture.sandbox = { payment_id: payment.id, confirmation_url: payment.confirmation_url, stage: 'pending' };
      fixture.sandbox_payment_ids = [...new Set([...(fixture.sandbox_payment_ids || []), payment.id])];
      fs.writeFileSync(authPath, JSON.stringify(fixture), { mode: 0o600 });
      await page.getByText('История оплат подписок', { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(screenshots, 'live-subscription-pending-390.png') });
      console.log(JSON.stringify({ stage: 'pending', payment_id: payment.id, test_mode: true }));
    } else if (process.argv[2] === 'inspect' || process.argv[2] === 'pay') {
      if (!fixture.sandbox) throw new Error('PREPARE_FIRST');
      const payment = await api('/subscriptions/payments/' + fixture.sandbox.payment_id);
      if (payment.status === 'succeeded') { console.log(JSON.stringify({ stage: 'succeeded', payment_id: payment.id })); return; }
      await go(page, fixture.sandbox.confirmation_url); await page.waitForTimeout(2000);
      if (process.argv[2] === 'pay') {
        const wallet = page.getByText('Ваш кошелёк', { exact: true });
        await wallet.waitFor({ state: 'visible', timeout: 25000 }); await wallet.click(); await page.waitForTimeout(1000);
        const pay = page.getByRole('button', { name: /Заплатить|Оплатить/ }).last();
        await pay.waitFor({ state: 'visible', timeout: 15000 }); await pay.click(); await page.waitForTimeout(4000);
      }
      await page.screenshot({ path: path.join(screenshots, 'live-yookassa-' + process.argv[2] + '-390.png') });
      const buttons = await page.getByRole('button').allTextContents();
      const inputs = await page.locator('input').evaluateAll(rows => rows.map(x => ({ name: x.name, placeholder: x.placeholder, type: x.type })));
      const current = await api('/subscriptions/payments/' + fixture.sandbox.payment_id);
      console.log(JSON.stringify({ stage: current.status, payment_id: current.id, buttons, inputs, body: (await page.locator('body').innerText()).slice(0, 1400).replace(/https?:\/\/\S+/g, '[URL]') }));
    } else throw new Error('Use prepare, inspect or pay');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(String(error.message).replace(/https?:\/\/[^\s)]+/g, '[URL]')); process.exit(1); });
