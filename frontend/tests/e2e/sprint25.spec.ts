import { expect, test } from '@playwright/test';
test.use({ serviceWorkers: 'block' });
const cities = [
  { id: '10000000-0000-4000-8000-000000000001', name: 'Тюмень', region: 'Тюменская область', code: 'tyumen', is_active: true, is_default: true, center_lat: 57, center_lon: 65, map_zoom: 11 },
  { id: '10000000-0000-4000-8000-000000000002', name: 'Екатеринбург', region: 'Свердловская область', code: 'ekb', is_active: true, is_default: false, center_lat: 56, center_lon: 60, map_zoom: 11 },
];
const driverId = '20000000-0000-4000-8000-000000000001';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'qa-only', role: 'logist' }, version: 0 }));
    localStorage.setItem('selected-city', JSON.stringify({ state: { cityId: '10000000-0000-4000-8000-000000000001' }, version: 1 }));
  });
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    let body: unknown = [];
    if (url.pathname.endsWith('/cities/')) body = cities;
    if (url.pathname.endsWith('/admin/drivers')) {
      const city = url.searchParams.get('city_id');
      body = [{ id: driverId, name: city === cities[1].id ? 'Водитель Екатеринбурга' : 'Водитель Тюмени', phone: '+79990000001',
        city_ids: city ? [city] : [], status: 'offline', is_active: true, is_on_shift: false,
        moderation_status: 'approved', dispatch_exclusion_reasons: city ? ['shift_off'] : ['city_missing'], vehicle: null }];
    }
    if (url.pathname.endsWith('/' + driverId + '/cities')) body = { city_ids: route.request().method() === 'PATCH' ? route.request().postDataJSON().city_ids : [] };
    if (url.pathname.endsWith('/admin/me')) body = { email: 'qa@example.invalid' };
    await route.fulfill({ json: body });
  });
});
for (const width of [390, 1440]) {
  test('городской фильтр и привязка логистом на ' + width, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/logist/orders');
    await page.getByRole('button', { name: 'Водители', exact: true }).filter({ visible: true }).click();
    await expect(page.getByText('Водитель Тюмени', { exact: true })).toBeVisible();
    await page.getByLabel('Город', { exact: true }).selectOption(cities[1].id);
    await expect(page.getByText('Водитель Екатеринбурга', { exact: true })).toBeVisible();
    await expect(page.getByText('Водитель Тюмени', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('selected-city')!).state.cityId)).toBe(cities[0].id);
    await page.getByRole('button', { name: 'Города обслуживания', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Екатеринбург, Свердловская область' }).check();
    const saved = page.waitForRequest(request => request.method() === 'PATCH' && request.url().endsWith('/cities'));
    await page.getByRole('button', { name: 'Сохранить города' }).click();
    expect((await saved).postDataJSON().city_ids).toEqual([cities[1].id]);
    expect(await page.locator('header').first().evaluate(element => parseFloat(getComputedStyle(element).paddingTop))).toBeGreaterThanOrEqual(40);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath('sprint25-drivers-' + width + '.png'), fullPage: true });
  });
}
