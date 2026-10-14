import { expect, test, type Page } from '@playwright/test';

const orderId = '11111111-2222-4333-8444-555555555555';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="#38bdf8"/></svg>';
async function setup(page: Page, { material = '/s3/qa/material.svg', truck = '/s3/qa/truck.svg', state = 'unconfirmed', canPay = true, openOrders = true } = {}) {
  await page.addInitScript(() => {
    localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'e2e-client', role: 'client' }, version: 0 }));
    localStorage.setItem('selected-city', JSON.stringify({ state: { cityId: 'tyumen' }, version: 1 }));
  });
  await page.route('**/s3/qa/**', route => route.request().url().includes('broken')
    ? route.fulfill({ status: 404 }) : route.fulfill({ contentType: 'image/svg+xml', body: svg }));
  await page.route('**/static/vehicles/*.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: svg }));
  await page.route('**/api/v1/**', async route => {
    const p = new URL(route.request().url()).pathname.replace(/\/$/, '');
    let body: unknown = [];
    if (p.endsWith('/cities')) body = [{ id: 'tyumen', code: 'tyumen', name: 'Тюмень', is_active: true, is_default: true, center_lat: 57.15, center_lon: 65.53 }];
    else if (p.endsWith('/clients/me/orders')) body = [{ id: orderId, status: 'driver_assigned', payment_status: state === 'unconfirmed' || state === 'confirmed' ? null : state === 'paid' ? 'succeeded' : state, trip_count: 2, driver: { name: 'Тестовый водитель', phone: '+79000000001', vehicle: { brand: 'КамАЗ', plate_number: 'А123АА72' } }, total_amount: 78500, delivery_cost: 5000, address: 'Тюмень, Республики, 1', city_name: 'Тюмень', created_at: '2026-10-14T10:00:00Z', items: [{ quantity: 1, volume: 10, material: { name: 'Песок лесной', unit: 'м³', primary_image_url: material || null } }], delivery_option: { title: 'Самосвал', capacity_m3: 10, primary_image_url: truck || null } }];
    else if (p.endsWith('/payments/config')) body = { enabled: true, test_mode: true, receipts_enabled: true };
    else if (p.endsWith(`/orders/${orderId}/payments`)) body = { quote: state === 'unconfirmed' ? null : { amount: '78500.00' }, can_pay: canPay && ['confirmed', 'pending', 'waiting_for_payment'].includes(state), items: state === 'paid' || state === 'pending' || state === 'waiting_for_payment' ? [{ id: 'payment-1', status: state === 'paid' ? 'succeeded' : state, amount: '78500.00' }] : [] };
    else if (p.endsWith('/system/version')) body = { android_version: '3.3.6', download_url: '/static/darmavoz-test.apk' };
    await route.fulfill({ json: body });
  });
  await page.goto('/app');
  await page.getByRole('button', { name: 'Я Клиент', exact: true }).click();
  if (!openOrders) return page.locator('article').first();
  await page.getByRole('button', { name: 'Заказы', exact: true }).click();
  const card = page.locator(`[data-order-id="${orderId}"]`);
  await expect(card).toBeVisible();
  return card;
}

for (const width of [390, 1440]) {
  test(`card confirms waiting text and loads material at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const card = await setup(page);
    await expect(card.getByRole('heading', { name: 'Ожидает подтверждения', exact: true })).toBeVisible();
    await expect(card.getByText('Оплата станет доступна после проверки заказа логистом', { exact: true })).toBeVisible();
    await expect(card.getByText('Стоимость уточняется', { exact: true })).toHaveCount(0);
    await expect(card.locator('img')).toHaveJSProperty('naturalWidth', 320);
    await expect(card.locator('img')).toHaveAttribute('src', /\/s3\/qa\/material.svg$/);
    await expect(page.locator('main')).toHaveCSS('scrollbar-width', 'none');
    await expect(page.locator('html')).toHaveCSS('scrollbar-width', 'none');
    await card.getByRole('button', { name: 'Отменить заказ', exact: true }).scrollIntoViewIfNeeded();
    await expect(card.getByRole('button', { name: 'Отменить заказ', exact: true })).toBeInViewport();
    await page.screenshot({ path: `test-results/client-order-${width}.png` });
  });
}

test('broken material image falls back to the selected delivery image', async ({ page }) => {
  const card = await setup(page, { material: '/s3/qa/broken.svg' });
  await expect(card.locator('img')).toHaveAttribute('src', /\/s3\/qa\/truck.svg$/);
  await expect(card.locator('img')).toHaveJSProperty('naturalWidth', 320);
});

test('missing material and broken delivery image use the bundled truck illustration', async ({ page }) => {
  const card = await setup(page, { material: '', truck: '/s3/qa/broken.svg' });
  await expect(card.locator('img')).toHaveAttribute('src', /\/static\/vehicles\/kamaz-dump-truck.svg$/);
  await expect(card.locator('img')).toHaveJSProperty('naturalWidth', 320);
});

for (const state of ['confirmed', 'paid']) {
  test(`payment panel preserves ${state} behavior`, async ({ page }) => {
    const card = await setup(page, { state });
    await expect(card.getByRole('heading', { name: 'Оплата заказа', exact: true })).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Ожидает подтверждения' })).toHaveCount(0);
    if (state === 'paid') await expect(card.getByText('Оплачено', { exact: true })).toBeVisible();
    else await expect(card.getByRole('button', { name: 'Оплатить заказ', exact: true })).toBeVisible();
  });
}

for (const width of [390, 1440]) {
  test(`pending payment card has the required block order at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const card = await setup(page, { state: 'pending' });
    const driver = card.getByRole('region', { name: 'Водитель', exact: true });
    const address = card.getByRole('region', { name: 'Адрес доставки', exact: true });
    const payment = card.getByRole('region', { name: 'Оплата заказа', exact: true });
    await expect(driver).toContainText('Тестовый водитель');
    await expect(driver).toContainText('КамАЗ');
    await expect(driver).not.toContainText('А123АА72');
    await expect(driver).not.toContainText('Госномер');
    await expect(address).toContainText('Город: Тюмень');
    await expect(payment.getByRole('textbox', { name: 'Почта для чека' })).toBeVisible();
    await expect(payment.getByRole('button', { name: 'Продолжить оплату', exact: true })).toBeVisible();
    const blocks = [
      card.getByRole('heading', { name: /Песок лесной.*10 м³/ }),
      card.getByText('Самосвал · 2 рейса', { exact: true }),
      card.locator('img'),
      card.getByText('Сумма', { exact: true }),
      driver, address, payment,
      card.getByRole('button', { name: 'Отменить заказ', exact: true }),
    ];
    const handles = await Promise.all(blocks.map(locator => locator.elementHandle()));
    for (let index = 1; index < handles.length; index++) {
      expect(await handles[index - 1]!.evaluate((node, next) =>
        Boolean(node.compareDocumentPosition(next!) & Node.DOCUMENT_POSITION_FOLLOWING),
      handles[index])).toBe(true);
    }
    await expect(card.getByText('Ожидает оплаты', { exact: true })).toHaveCount(2);
    await expect(card.getByText('Водитель назначен', { exact: true })).toHaveCount(0);
    const tracker = page.getByRole('button', { name: 'Открыть активный заказ: Песок лесной', exact: true });
    await expect(tracker).toContainText('Ожидает оплаты');
    await expect(tracker).not.toContainText('Водитель назначен');
    await page.screenshot({ path: `test-results/client-order-reordered-${width}.png` });
  });
}

test('tracker prioritizes open payment before visiting the orders tab', async ({ page }) => {
  await setup(page, { state: 'waiting_for_payment', openOrders: false });
  await expect(page.getByRole('button', { name: 'Открыть активный заказ: Песок лесной', exact: true })).toContainText('Ожидает оплаты');
});

test('closed payment availability keeps the logistics status', async ({ page }) => {
  const card = await setup(page, { state: 'pending', canPay: false });
  await expect(card.getByText('Водитель назначен', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Продолжить оплату', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Открыть активный заказ: Песок лесной', exact: true })).toContainText('Водитель назначен');
});

test('successful payment restores logistics status in card and tracker', async ({ page }) => {
  const card = await setup(page, { state: 'pending' });
  await expect(card.getByText('Ожидает оплаты', { exact: true })).toHaveCount(2);
  await page.route(`**/orders/${orderId}/payments`, route => route.fulfill({ json: {
    can_pay: false, quote: { amount: '78500.00' },
    items: [{ id: 'payment-1', status: 'succeeded', amount: '78500.00' }],
  } }));
  await card.getByRole('button', { name: 'Обновить оплату', exact: true }).click();
  await expect(card.getByText('Водитель назначен', { exact: true })).toBeVisible();
  await expect(card.getByText('Оплачено', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Открыть активный заказ: Песок лесной', exact: true })).toContainText('Водитель назначен');
});
