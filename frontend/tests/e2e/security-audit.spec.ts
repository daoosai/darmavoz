import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const city = {
  id: '10000000-0000-4000-8000-000000000001', name: 'Екатеринбург',
  region: 'Свердловская область с длинным названием для проверки переполнения',
  code: 'ekb', is_active: true, is_default: true,
  center_lat: 56.84, center_lon: 60.6, map_zoom: 11,
};
async function session(page: import('@playwright/test').Page, role: string) {
  await page.addInitScript(role => localStorage.setItem('auth-storage',
    JSON.stringify({ state: { token: 'qa-only', role }, version: 0 })), role);
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = [];
    if (path.endsWith('/cities/')) body = [city];
    if (path.endsWith('/statistics')) body = { total_orders: 0, completed_orders: 0, total_revenue: 0, total_drivers: 0, active_drivers: 0 };
    if (path.endsWith('/me')) body = { display_name: 'QA', phone: '+79990000000' };
    if (path.endsWith('/placements/summary')) {
      const counts = { trial: 0, active: 0, confirmation_required: 0, hidden: 0, expired: 0, archived: 0 };
      body = { totals: counts, by_entity: { quarry: counts, accumulator: counts, special_equipment: counts }, policy: { extension_days: 30 } };
    }
    await route.fulfill({ json: body });
  });
}

for (const width of [320, 390, 768, 1440]) {
  for (const [role, path] of [
    ['admin', '/admin/orders'], ['admin', '/admin/statistics'], ['logist', '/logist/statistics'],
  ]) {
    test(path + ': city selector fits ' + width + 'px', async ({ page }) => {
      await session(page, role);
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(path);
      await expect(page.getByRole('combobox', { name: 'Город', exact: true }).locator('option')).toHaveCount(2);
      await page.getByRole('combobox', { name: 'Город', exact: true }).selectOption(city.id);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]);
    });
  }
}

test('rejection presets remain editable and reset for the next request', async ({ page }) => {
  await session(page, 'admin');
  let submittedReason = '';
  let rejected = false;
  const row = {
    id: '20000000-0000-4000-8000-000000000001', author_id: 'supplier', city_id: city.id,
    material_name: 'QA песок', volume: '10', unit: 'm3', status: 'pending',
    pickup_address: 'QA pickup', delivery_address: 'QA delivery',
    starts_on: '2026-10-16', ends_on: '2026-10-18',
    price: '100', price_basis: 'm3', contact_name: 'QA', contact_phone: '+79990000000',
    is_owner: false, is_favorite: false, created_at: '2026-10-16T00:00:00Z',
  };
  await page.route('**/api/v1/wholesale-requests**', async route => {
    if (route.request().method() === 'POST') {
      submittedReason = route.request().postDataJSON().reason;
      rejected = true;
      return route.fulfill({ json: { ...row, status: 'rejected', reject_reason: submittedReason } });
    }
    return route.fulfill({ json: { items: [{ ...row, id: rejected ? '20000000-0000-4000-8000-000000000002' : row.id }], total: 1 } });
  });
  await page.goto('/admin/wholesale');
  await page.getByRole('button', { name: 'Отклонить', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Причина отклонения', exact: true });
  await dialog.getByRole('button', { name: 'Адреса', exact: true }).click();
  await expect(dialog.getByRole('textbox')).toHaveValue('Уточните адреса загрузки и доставки.');
  await dialog.getByRole('textbox').fill('Уточните адреса загрузки и доставки. Нужен номер участка.');
  await dialog.getByRole('button', { name: 'Отклонить заявку', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(submittedReason).toContain('Нужен номер участка.');
  await page.getByRole('button', { name: 'Отклонить', exact: true }).click();
  await expect(dialog.getByRole('textbox')).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Отклонить заявку', exact: true })).toBeDisabled();
});

for (const key of ['Enter', 'Space']) {
  test('equipment create button has accessible name and works with ' + key, async ({ page }) => {
    await session(page, 'equipment_owner');
    await page.goto('/');
    const button = page.getByRole('button', { name: 'Добавить объявление спецтехники', exact: true });
    await button.focus();
    await expect(button).toBeFocused();
    await page.keyboard.press(key);
    await expect(page.getByRole('heading', { name: 'Новое объявление', exact: true })).toBeVisible();
  });
}
