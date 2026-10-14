import { expect, test, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const orderId = '11111111-2222-4333-8444-555555555555';
const otherId = '11111111-2222-4333-8444-666666666666';

async function setup(page: Page, initialStatus: string, options: { authenticated?: boolean; failFirst?: boolean; emptyOrders?: boolean } = {}) {
  const { authenticated = true, failFirst = false, emptyOrders = false } = options;
  let status = initialStatus;
  let calls = 0;
  let failing = failFirst;
  await page.addInitScript(authenticated => {
    if (authenticated) localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'e2e-client', role: 'client' }, version: 0 }));
  }, authenticated);
  await page.route('**/static/vehicles/*.svg', route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>',
  }));
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace(/\/$/, '');
    let body: unknown = [];
    if (path.endsWith('/cities')) body = [{ id: 'tyumen', name: 'Тюмень', code: 'tyumen', is_active: true, is_default: true, center_lat: 57, center_lon: 65 }];
    else if (path.endsWith('/clients/me/orders')) body = emptyOrders ? [] : [orderId, otherId].map(id => ({
      id, status: 'driver_assigned', payment_status: status, address: 'Тюмень, Ленина, 1',
      created_at: '2026-10-14T10:00:00Z', total_amount: 1000,
      items: [{ quantity: 1, volume: 5, material: { name: 'Песок', unit: 'м³' } }],
      delivery_option: { title: 'Самосвал', capacity_m3: 5 },
    }));
    else if (path.endsWith('/payments/config')) body = { enabled: true, receipts_enabled: true };
    else if (path.endsWith('/payments') && path.includes('/orders/')) {
      calls++;
      if (failing) return route.fulfill({ status: 502, json: { detail: 'Temporary outage' } });
      body = { order_id: orderId, quote: { amount: '1000.00' }, can_pay: status !== 'succeeded',
        items: [{ id: 'payment-1', status, amount: '1000.00' }] };
    }
    else if (path.endsWith('/system/version')) body = { android_version: '3.3.6', download_url: '/static/darmavoz-test.apk' };
    await route.fulfill({ json: body });
  });
  await page.goto('/app?payment_order=' + orderId);
  const screen = page.locator('section.fixed').filter({
    has: page.getByRole('heading', { name: 'Результат оплаты', exact: true }),
  });
  return { screen, setStatus: (next: string) => { status = next; }, recover: () => { failing = false; }, calls: () => calls };
}

for (const width of [390, 1440]) {
  test(`success is green and redirects to the exact order at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const { screen } = await setup(page, 'succeeded');
    await expect(screen.getByRole('heading', { name: 'Оплата прошла успешно!', exact: true })).toBeVisible();
    await expect(screen.getByLabel('Оплата успешна', { exact: true })).toHaveClass(/text-green-500/);
    await expect(screen.getByText('Сейчас вы будете перенаправлены к заказу...', { exact: true })).toBeVisible();
    await expect(screen.getByText(/Проверяем оплату/)).toHaveCount(0);
    await page.screenshot({ path: `test-results/payment-success-${width}.png` });
    await expect(page).toHaveURL(new RegExp('/client/orders/' + orderId + '$'), { timeout: 6000 });
    await expect(page.locator(`[data-order-id="${orderId}"]`)).toBeVisible();
    await expect(page.locator(`[data-order-id="${otherId}"]`)).toHaveCount(0);
    await expect(screen).toHaveCount(0);
  });
}

for (const initial of ['pending', 'waiting_for_capture']) {
  test(`${initial} polls and redirects after bank confirmation`, async ({ page }) => {
    const { screen, setStatus, calls } = await setup(page, initial, { emptyOrders: true });
    await expect(screen.getByRole('heading', { name: 'Ожидаем подтверждения от банка', exact: true })).toBeVisible();
    await expect(screen.getByLabel('Ожидаем подтверждения', { exact: true })).toHaveClass(/animate-spin/);
    await expect(screen.getByText('Пожалуйста, подождите несколько секунд...', { exact: true })).toBeVisible();
    const baseline = calls();
    expect(baseline).toBeGreaterThan(0);
    await page.screenshot({ path: `test-results/payment-${initial}.png` });
    setStatus('succeeded');
    await expect(screen.getByRole('heading', { name: 'Оплата прошла успешно!', exact: true })).toBeVisible({ timeout: 4000 });
    expect(calls()).toBe(baseline + 1);
    await expect(page).toHaveURL(new RegExp('/client/orders/' + orderId + '$'), { timeout: 6000 });
  });
}

test('canceled payment stays available for manual return without false success', async ({ page }) => {
  const { screen, calls } = await setup(page, 'canceled', { emptyOrders: true });
  await expect(screen.getByRole('heading', { name: 'Оплата не завершена', exact: true })).toBeVisible();
  const baseline = calls();
  await page.waitForTimeout(3000);
  expect(calls()).toBe(baseline);
  await expect(page).toHaveURL(/payment_order=/);
  await screen.getByRole('button', { name: 'Вернуться к заказу', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/client/orders/' + orderId + '$'));
  await expect(screen).toHaveCount(0);
});

test('temporary API error retries and does not claim payment failed', async ({ page }) => {
  const { screen, calls, recover } = await setup(page, 'succeeded', { failFirst: true, emptyOrders: true });
  await expect(screen.getByText('Не удалось обновить статус. Повторяем проверку…', { exact: true })).toBeVisible();
  await expect(screen.getByRole('heading', { name: 'Оплата не завершена', exact: true })).toHaveCount(0);
  const baseline = calls();
  recover();
  await expect(screen.getByRole('heading', { name: 'Оплата прошла успешно!', exact: true })).toBeVisible({ timeout: 4000 });
  expect(calls()).toBe(baseline + 1);
  await expect(page).toHaveURL(new RegExp('/client/orders/' + orderId + '$'), { timeout: 6000 });
});

test('unauthenticated return does not query payments or redirect as paid', async ({ page }) => {
  const { screen, calls } = await setup(page, 'succeeded', { authenticated: false });
  await expect(screen.getByText('Для просмотра результата войдите в аккаунт, из которого оформлен заказ.', { exact: true })).toBeVisible();
  await page.waitForTimeout(3000);
  expect(calls()).toBe(0);
  await expect(page).toHaveURL(/payment_order=/);
});

test('leaving a pending result stops its polling timer', async ({ page }) => {
  const { screen, calls, setStatus } = await setup(page, 'pending', { emptyOrders: true });
  await expect(screen.getByRole('heading', { name: 'Ожидаем подтверждения от банка', exact: true })).toBeVisible();
  await screen.getByRole('button', { name: 'Вернуться к заказу', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/client/orders/' + orderId + '$'));
  const baseline = calls();
  setStatus('succeeded');
  await page.waitForTimeout(3000);
  expect(calls()).toBe(baseline);
  await expect(screen).toHaveCount(0);
});
