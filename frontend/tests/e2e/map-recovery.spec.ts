import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const sdk = `window.mapgl={
 isSupported:()=>!window.__webglUnavailable,
 Map:class{constructor(el){if(window.__initializationFailure)throw new Error("Map init failed");window.__mapCreated=(window.__mapCreated||0)+1;this.el=el}
 destroy(){}setCenter(){}setZoom(){}fitBounds(){}},
 HtmlMarker:class{constructor(map,{html}){this.el=html;map.el.appendChild(html)}destroy(){this.el.remove()}}
};`;
for (const width of [390, 1440]) {
  test(`map recovers from failed SDK load without reloading at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 57.15, longitude: 65.53 });
    let failSdk = true, loads = 0;
    await page.route('https://mapgl.2gis.com/api/js/**', route => {
      loads++;
      return failSdk ? route.abort('connectionfailed') : route.fulfill({ contentType: 'application/javascript', body: sdk });
    });
    await page.route('**/api/v1/**', route => {
      const p = new URL(route.request().url()).pathname.replace(/\/$/, '');
      return route.fulfill({ json: p.endsWith('/cities') ? [{ id: 'tyumen', code: 'tyumen', name: 'Тюмень', is_active: true, is_default: true, center_lat: 57.15, center_lon: 65.53 }] : p.endsWith('/pickup-points/global') ? [{
        id: 'quarry', name: 'Тестовый карьер', lat: 57.15, lon: 65.53, point_type: 'quarry', crm_status: 'activated', is_active: true, material_offers: [],
      }] : [] });
    });
    await page.goto('/app');
    await page.getByRole('button', { name: 'Я Клиент', exact: true }).click();
    await page.getByRole('button', { name: 'Карта', exact: true }).click();
    await expect(page.getByText('Не удалось загрузить карту 2ГИС. Проверьте соединение и повторите загрузку.', { exact: true })).toBeVisible();
    await expect(page.getByText(/требуется поддержка WebGL/)).toHaveCount(0);
    failSdk = false;
    await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    await expect(page.locator('.global-pickup-marker')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Повторить загрузку', exact: true })).toHaveCount(0);
    expect(loads).toBeGreaterThanOrEqual(3);
  });
}

for (const reason of ['webgl', 'initialization']) {
  test(`map distinguishes ${reason} and supports retry`, async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 57.15, longitude: 65.53 });
    await page.addInitScript(reason => {
      (window as any).__webglUnavailable = reason === 'webgl';
      (window as any).__initializationFailure = reason === 'initialization';
    }, reason);
    await page.route('https://mapgl.2gis.com/api/js/**', route => route.fulfill({ contentType: 'application/javascript', body: sdk }));
    await page.route('**/api/v1/**', route => {
      const p = new URL(route.request().url()).pathname.replace(/\/$/, '');
      return route.fulfill({ json: p.endsWith('/cities') ? [{ id: 'tyumen', code: 'tyumen', name: 'Тюмень', is_active: true, is_default: true }] : [] });
    });
    await page.goto('/app');
    await page.getByRole('button', { name: 'Я Клиент', exact: true }).click();
    await page.getByRole('button', { name: 'Карта', exact: true }).click();
    const message = reason === 'webgl' ? 'В этом браузере недоступен WebGL — карта не может отобразиться. Попробуйте другой браузер.' : 'Не удалось открыть карту. Попробуйте загрузить её ещё раз.';
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await page.evaluate(() => { (window as any).__webglUnavailable = false; (window as any).__initializationFailure = false; });
    await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Повторить загрузку', exact: true })).toHaveCount(0);
    await expect(page.getByText(message, { exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as any).__mapCreated)).toBe(1);
  });
}
