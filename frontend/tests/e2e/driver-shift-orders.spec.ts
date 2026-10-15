import { expect, test, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const orderId = '11111111-2222-4333-8444-555555555555';
async function setup(page: Page, { location = 'denied', assignedEndpoint = true, failShift = false } = {}) {
  let onShift = false;
  const updates: boolean[] = [];
  await page.addInitScript(({ location }) => {
    localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'qa-driver', role: 'driver' }, version: 0 }));
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: {
      query: async () => {
        if (location === 'unsupported') throw new Error('Permissions unavailable');
        return { state: 'prompt' };
      },
    } });
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: (success: PositionCallback, failure: PositionErrorCallback) => {
        if (location === 'granted') success({ coords: { latitude: 57.15, longitude: 65.53, accuracy: 20 }, timestamp: Date.now() } as GeolocationPosition);
        else if (location === 'unsupported') throw new Error('GPS unavailable');
        else failure({ code: 1, message: 'Permission denied' } as GeolocationPositionError);
      },
    } });
  }, { location });
  const order = { id: orderId, status: 'driver_assigned', payment_status: 'succeeded',
    address: 'Тюмень, Республики, 10', delivery_address: 'Тюмень, Республики, 10',
    pickup_address: 'Карьер Тестовый', created_at: '2026-10-14T10:00:00Z',
    total_amount: 25000, delivery_cost: 5000,
    material_name: 'Песок тестовый', capacity_m3: 10,
    items: [{ material: { name: 'Песок тестовый' }, volume: 10 }],
    delivery_option: { capacity_m3: 10 } };
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace(/\/$/, '');
    let body: unknown = [];
    if (path.endsWith('/driver/profile/shift')) {
      updates.push(route.request().postDataJSON().is_on_shift);
      if (failShift) return route.fulfill({ status: 500, json: { detail: 'Shift unavailable' } });
      onShift = updates.at(-1)!;
      body = { ok: true, is_on_shift: onShift, status: onShift ? 'busy' : 'offline' };
    } else if (path.endsWith('/driver/profile/full')) body = {
      id: 'driver-1', name: 'Тестовый водитель', phone: '+79000000001',
      status: onShift ? 'busy' : 'offline', is_active: true, moderation_status: 'approved',
      is_on_shift: onShift, vehicle: { brand: 'КамАЗ', plate_number: 'А123АА72', media_files: [], moderation_status: 'approved' },
    };
    else if (path.endsWith('/driver/orders/assigned/current')) body = assignedEndpoint ? { order_id: orderId, order } : {};
    else if (path.endsWith('/driver/orders/incoming/current')) body = {};
    else if (path.endsWith('/driver/orders')) body = [order];
    else if (path.endsWith('/system/version')) body = { android_version: '3.3.6' };
    await route.fulfill({ json: body });
  });
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Активные заказы', exact: true })).toBeVisible();
  return updates;
}

for (const width of [390, 1440]) {
  for (const assignedEndpoint of [true, false]) {
    test(`assigned paid order is visible off shift via ${assignedEndpoint ? 'current' : 'list'} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const updates = await setup(page, { assignedEndpoint });
      await expect(page.getByRole('switch', { name: 'Начать смену' })).toBeVisible();
      await expect(page.getByText('Песок тестовый', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Выехать на карьер', exact: true })).toBeVisible();
      expect(updates).toEqual([]);
    });
  }
  for (const location of ['denied', 'unsupported', 'granted']) {
    test(`web shift starts with location ${location} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const updates = await setup(page, { location });
      await page.getByRole('switch', { name: 'Начать смену' }).click();
      const dialog = page.getByRole('dialog', { name: 'Использование местоположения' });
      await dialog.getByRole('button', { name: 'Продолжить', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect.poll(() => updates).toEqual([true]);
      await expect(page.getByRole('switch', { name: 'Начать смену' })).toHaveCount(0);
      await expect(page.getByText('Песок тестовый', { exact: true })).toBeVisible();
      if (location !== 'granted') await expect(page.getByText('Фоновая геопозиция недоступна в браузере, но смена начата', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Профиль', exact: true }).click();
      const toggle = page.getByRole('switch', { name: 'На смене', exact: true });
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      if (location === 'denied') await page.screenshot({ path: `test-results/driver-web-shift-${width}.png` });
      await toggle.click();
      await expect.poll(() => updates).toEqual([true, false]);
      await page.getByRole('button', { name: 'Заказы', exact: true }).click();
      await expect(page.getByRole('switch', { name: 'Начать смену' })).toBeVisible();
      await expect(page.getByText('Песок тестовый', { exact: true })).toBeVisible();
    });
  }
}

test('canceling disclosure does not start shift', async ({ page }) => {
  const updates = await setup(page);
  await page.getByRole('switch', { name: 'Начать смену' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click();
  expect(updates).toEqual([]);
  await expect(page.getByRole('switch', { name: 'Начать смену' })).toBeVisible();
});

test('shift API failure does not claim shift started', async ({ page }) => {
  await setup(page, { failShift: true });
  await page.getByRole('switch', { name: 'Начать смену' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.getByText('Не удалось изменить статус смены', { exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Начать смену' })).toBeVisible();
  await expect(page.getByText('Фоновая геопозиция недоступна в браузере, но смена начата', { exact: true })).toHaveCount(0);
});
