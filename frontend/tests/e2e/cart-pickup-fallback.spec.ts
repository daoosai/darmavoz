import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const city = { id: 'city', code: 'tyumen', name: 'Тюмень', is_active: true, is_default: true, center_lat: 57.15, center_lon: 65.53 };
const material = { id: 'brick', name: 'Бой кирпича', price: 1, unit: 'м3', min_volume: 1, is_active: true };
const truck = { id: 'truck', title: 'Самосвал', capacity_m3: 20, is_active: true };
const point = { id: 'storage', city_id: city.id, name: 'Новый накопитель', short_name: 'Новый накопитель',
  material_id: material.id, point_type: 'accumulator', lat: 57.15, lon: 65.51,
  price: 1, unit: 'м3', crm_status: 'activated', is_active: true, is_ready: true, address: 'Тюмень',
  material_offers: [{ material_id: material.id, material_name: material.name, price: 1, unit: 'м3', is_active: true }],
  delivery_options: [truck], media_files: [],
};

for (const width of [390, 1440]) {
  test('cart fallback selects and retains storage after reload at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(({ city, material, truck }) => {
      if (localStorage.getItem('cart-storage')) return;
      localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'e2e-only', role: 'client' }, version: 0 }));
      localStorage.setItem('selected-city', JSON.stringify({ state: { cityId: city.id }, version: 1 }));
      localStorage.setItem('address-storage', JSON.stringify({ state: {
        selectedAddress: 'Тюмень, Пермякова 9', selectedAddressCoordinates: { lat: 57.128508, lon: 65.595645 },
      }, version: 0 }));
      localStorage.setItem('cart-storage', JSON.stringify({ state: {
        cartCityId: city.id, cityCarts: {}, cartItems: [{ id: 'cart-brick', material, deliveryOption: truck, quantity: 1, volume: 10 }],
      }, version: 1 }));
    }, { city, material, truck });
    await page.route('https://mapgl.2gis.com/api/js/**', route => route.fulfill({
      contentType: 'application/javascript', body: `window.mapgl={
        isSupported:()=>true, Map:class{constructor(el){this.el=el}destroy(){}setCenter(){}setZoom(){}fitBounds(){}},
        HtmlMarker:class{constructor(map,{html}){this.el=html;map.el.appendChild(html)}destroy(){this.el.remove()}}
      };`,
    }));
    const calculations: Record<string, unknown>[] = [];
    await page.route('**/api/v1/**', route => {
      const url = new URL(route.request().url());
      const p = url.pathname.replace(/\/$/, '');
      if (p.endsWith('/client/orders/calculate')) {
        const body = route.request().postDataJSON();
        calculations.push(body);
        if (!body.quarry_id) return route.fulfill({ status: 404, json: { detail: 'Подходящие точки не найдены.' } });
        return route.fulfill({ json: { best_option: {
          quarry_id: point.id, quarry_name: point.name, point_type: 'accumulator', distance: 7,
          material_cost: body.volume, delivery_cost: 0, total_amount: body.volume, rating: 5,
        }, alternatives: [] } });
      }
      const body = p.endsWith('/cities') ? [city]
        : p.endsWith('/pickup-points/storage') ? point
        : p.endsWith('/pickup-points') || p.endsWith('/pickup-points/map') ? [point]
        : p.endsWith('/delivery-options') ? [truck]
        : p.endsWith('/materials') ? [material]
        : p.endsWith('/app-version') ? { version: '3.1.7', force_update: false }
        : [];
      return route.fulfill({ json: body });
    });
    await page.goto('/app');
    if (await page.getByRole('button', { name: 'Я Клиент', exact: true }).isVisible())
      await page.getByRole('button', { name: 'Я Клиент', exact: true }).click();
    await page.getByRole('button', { name: /Корзина/ }).click();
    await expect(page.getByText('Подходящие точки не найдены.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Выбрать карьер/накопитель на карте', exact: true }).click();
    await expect(page.getByText('Выберите категорию и объём', { exact: true })).toHaveCount(0);
    await page.locator('[data-point-id="storage"]').click();
    await page.getByRole('button', { name: 'Выбрать накопитель', exact: true }).click();
    await expect(page.getByText('ВЫ ВЫБРАЛИ', { exact: true })).toBeVisible();
    await expect(page.getByText('Подходящие точки не найдены.', { exact: true })).toHaveCount(0);
    expect(calculations.at(-1)).toMatchObject({ quarry_id: point.id, volume: 10 });
    await expect(page.getByRole('heading', { name: point.name, exact: true })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cart-storage')!).state.cartItems[0].preferredPointId)).toBe(point.id);
    const summary = page.locator('section').filter({ has: page.getByRole('heading', { name: material.name, exact: true }) });
    await expect(summary.getByText('10 ₽', { exact: true })).toHaveCount(2);
    await expect(summary.getByText('0 ₽', { exact: true })).toBeVisible();
    await page.reload();
    if (await page.getByRole('button', { name: 'Я Клиент', exact: true }).isVisible())
      await page.getByRole('button', { name: 'Я Клиент', exact: true }).click();
    await page.getByRole('button', { name: /Корзина/ }).click();
    await expect(page.getByText('ВЫ ВЫБРАЛИ', { exact: true })).toBeVisible();
    expect(calculations.at(-1)).toMatchObject({ quarry_id: point.id, volume: 10 });
    await expect(page.getByText('Подходящие точки не найдены.', { exact: true })).toHaveCount(0);
  });
}
