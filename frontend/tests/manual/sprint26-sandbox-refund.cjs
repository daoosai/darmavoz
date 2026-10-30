/* Test-store-only partial refund via the published administrator UI. No real money. */
const fs = require('node:fs');
const { chromium } = require('playwright');
const base = 'https://test.darmavoz.ru';
const privatePath = '/opt/darmavoz_test_backups/sprint26/qa-auth.json';
const fixtures = JSON.parse(fs.readFileSync(privatePath));
const reportPath = '/opt/darmavoz_test/docs/reports/sprint26';
async function api(route, body, actor = fixtures.admin) {
  const response = await fetch(base + '/api/v1' + route, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + actor.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const value = await response.json();
  if (!response.ok) throw new Error('QA API ' + route + ': ' + response.status);
  return value;
}
async function main() {
  if ((await api('/payments/config')).test_mode !== true) throw new Error('TEST_SHOP_REQUIRED');
  const paymentId = fixtures.sandbox.payment_id;
  let payment = await api('/subscriptions/payments/' + paymentId);
  if (payment.account_id !== fixtures.supplier.id || payment.status !== 'succeeded' || Number(payment.amount) !== 10) throw new Error('QA_SUCCEEDED_PAYMENT_ONLY');
  if (!fixtures.refund_other_grant_id) {
    const grant = await api('/subscriptions/admin/grants', { account_id: fixtures.supplier.id, category: 'quarry', starts_at: new Date(Date.now() - 1000).toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), reason: 'QA independent basis for source-only sandbox refund verification' });
    fixtures.refund_other_grant_id = grant.id;
    fs.writeFileSync(privatePath, JSON.stringify(fixtures), { mode: 0o600 });
  }
  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', storageState: { cookies: [], origins: [{ origin: base, localStorage: [{ name: 'auth-storage', value: JSON.stringify({ state: { token: fixtures.admin.token, role: 'admin' }, version: 0 }) }, { name: 'selected-city', value: JSON.stringify({ state: { cityId: fixtures.city_id }, version: 1 }) }] }] } });
    const page = await context.newPage();
    await page.goto(base + '/admin/profile');
    await page.getByText('Управление подписками', { exact: true }).click();
    const card = page.locator('article').filter({ hasText: paymentId });
    await card.waitFor();
    if (!payment.refunds.length) {
      await card.getByRole('button', { name: 'Оформить возврат подписки', exact: true }).click();
      const form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Возврат подписки', exact: true }) });
      await form.getByLabel('Сумма, ₽', { exact: true }).fill('3.00');
      await form.getByLabel('Причина возврата или решения', { exact: true }).fill('QA sandbox partial refund; commercial policy is not approved');
      await form.getByRole('checkbox').check();
      for (const size of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(size); await form.scrollIntoViewIfNeeded();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        if (overflow) throw new Error('Refund form horizontal overflow at ' + size.width);
        await page.screenshot({ path: reportPath + '/screenshots/live-subscription-refund-form-' + size.width + '.png' });
      }
      const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/subscriptions/admin/payments/' + paymentId + '/refunds');
      await form.getByRole('button', { name: 'Подтвердить', exact: true }).click();
      const created = await response; if (created.status() !== 202) throw new Error('REFUND_UI_STATUS_' + created.status());
      fixtures.sandbox.refund_id = (await created.json()).id; fs.writeFileSync(privatePath, JSON.stringify(fixtures), { mode: 0o600 });
    }
    for (let i = 0; i < 45; i++) {
      payment = await api('/subscriptions/payments/' + paymentId);
      const row = payment.refunds.find(r => r.id === fixtures.sandbox.refund_id);
      if (row?.status === 'succeeded') break;
      if (row && ['failed', 'manual_review'].includes(row.status)) throw new Error('REFUND_PROVIDER_' + row.status + '_' + row.last_error);
      await page.waitForTimeout(1000);
    }
    let refund = payment.refunds.find(r => r.id === fixtures.sandbox.refund_id);
    if (!refund || refund.status !== 'succeeded' || Number(payment.refunded_amount) !== 3 || Number(payment.refundable_amount) !== 7) throw new Error('PARTIAL_REFUND_NOT_CONFIRMED');
    if (refund.access_review_required) {
      await page.getByRole('button', { name: 'Обновить', exact: true }).click();
      await card.getByRole('button', { name: 'Указать решение', exact: true }).click();
      const form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Решение по сроку доступа', exact: true }) });
      await form.getByRole('combobox').selectOption('keep');
      await form.getByLabel('Причина возврата или решения', { exact: true }).fill('QA technical keep decision for this source grant only; not a commercial refund rule');
      await form.getByRole('checkbox').check();
      const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/access-decision'));
      await form.getByRole('button', { name: 'Подтвердить', exact: true }).click();
      if ((await response).status() !== 200) throw new Error('ACCESS_DECISION_UI_FAILED');
    }
    payment = await api('/subscriptions/payments/' + paymentId); refund = payment.refunds.find(r => r.id === fixtures.sandbox.refund_id);
    if (refund.access_review_required || refund.access_adjustment?.action !== 'keep') throw new Error('ACCESS_DECISION_NOT_SAVED');
    await page.setViewportSize({ width: 390, height: 844 }); await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: reportPath + '/screenshots/live-subscription-refund-confirmed-390.png' });
    const summary = { payment_id: paymentId, refund_id: refund.id, payment_status: payment.status, refund_status: refund.status, amount: refund.amount, refunded_amount: payment.refunded_amount, refundable_amount: payment.refundable_amount, access_adjustment: refund.access_adjustment, review_required: refund.access_review_required, test_mode: true, ui: 'published test administrator UI', other_grant_id: fixtures.refund_other_grant_id };
    fs.writeFileSync(reportPath + '/sandbox-refund.json', JSON.stringify(summary, null, 2) + '\n');
    console.log(JSON.stringify(summary));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(String(error.message).replace(/https?:\/\/\S+/g, '[URL]')); process.exit(1); });
