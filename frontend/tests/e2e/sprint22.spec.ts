import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
const cities = [
  { id: 'city-1', code: 'tyumen', name: 'Тюмень', region: 'Тюменская область', is_active: true, is_default: true, center_lat: 57.15, center_lon: 65.53, map_zoom: 11, min_lat: 57, max_lat: 58, min_lon: 65, max_lon: 66, sort_order: 0 },
  { id: 'city-2', code: 'second', name: 'Второй город', region: 'Тестовая область', is_active: true, is_default: false, center_lat: 56.8, center_lon: 60.6, map_zoom: 11, min_lat: 56, max_lat: 57, min_lon: 60, max_lon: 61, sort_order: 1 },
];
const material = { id: 'sand', name: 'Песок', unit: 'м³', calculator_enabled: true, bulk_density_t_m3: 1.5, is_active: true, delivery_options: [] };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = [];
    if (url.pathname.endsWith('/cities/')) body = cities;
    else if (url.pathname.endsWith('/catalog/calculator/')) body = { materials: [material], delivery_options: [{ id: 'truck20', title: 'Кузов', capacity_m3: 20 }] };
    else if (url.pathname.includes('/catalog/materials/sand')) body = material;
    else if (url.pathname.endsWith('/catalog/materials/')) body = [material];
    else if (url.pathname.includes('/water-points/map')) {
      const cityId = url.searchParams.get('city_id');
      if (cityId === 'city-1') await new Promise((resolve) => setTimeout(resolve, 500));
      const isSecondCity = cityId === 'city-2';
      body = [{
        id: cityId,
        city_id: cityId,
        water_type: 'free',
        source: isSecondCity ? 'Источник второго города' : 'Источник Тюмени',
        address: 'Тестовый адрес',
        lat: isSecondCity ? 56.8 : 57,
        lon: isSecondCity ? 60.6 : 65,
      }];
    }
    await route.fulfill({ json: body });
  });
});

test('калькулятор показывает объём, тоннаж и загрузки без запроса цены', async ({ page }) => {
  const pricingRequests: string[] = [];
  page.on('request', (request) => { if (request.url().includes('/orders/calculate')) pricingRequests.push(request.url()); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Я Клиент' }).click();
  await page.getByRole('button', { name: 'Калькулятор материалов', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Калькулятор материалов' });
  await dialog.getByLabel('Материал', { exact: true }).selectOption('sand');
  await dialog.getByLabel('Единица толщины', { exact: true }).selectOption('m');
  await dialog.getByRole('button', { name: '0.05 м', exact: true }).click();
  await expect(dialog.getByLabel('Толщина слоя', { exact: true })).toHaveValue('0.05');
  await dialog.getByLabel('Единица толщины', { exact: true }).selectOption('cm');
  await expect(dialog.getByRole('button', { name: '5 см', exact: true })).toBeVisible();
  await dialog.getByLabel('Длина, м', { exact: true }).fill('10');
  await dialog.getByLabel('Ширина, м', { exact: true }).fill('10');
  await dialog.getByLabel('Толщина слоя', { exact: true }).fill('50');
  await expect(dialog.getByLabel('Кубатура машины, м³', { exact: true })).toHaveValue('20');
  await expect(dialog.getByLabel('Плотность, т/м³', { exact: true })).toHaveValue('1.5');
  await expect(dialog.getByText('50 м³', { exact: true })).toBeVisible();
  await expect(dialog.getByText('75 тонн', { exact: true })).toBeVisible();
  await expect(dialog.getByText('3 шт.', { exact: true })).toBeVisible();
  expect(pricingRequests).toEqual([]);
  const padding = await dialog.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingTop));
  expect(padding).toBeGreaterThanOrEqual(40);
});

test('сохранённый город восстанавливается без глобальной кнопки выбора', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('selected-city', JSON.stringify({ state: { cityId: 'city-2' }, version: 1 }));
  });
  await page.goto('/water');
  await page.getByRole('button', { name: 'Я Клиент' }).click();
  await expect(page.getByRole('button', { name: 'Выбрать город' })).toHaveCount(0);
  await expect(page.getByText('Источник второго города')).toBeVisible();
  await expect(page.getByText('Источник Тюмени')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('cart-storage')!).state.cartCityId)).toBe('city-2');
});
